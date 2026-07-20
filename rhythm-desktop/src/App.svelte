<script lang="ts">
  import { onMount } from 'svelte';
  import { bootEngine, getEngine, getLocal } from './lib/store';
  import type { Reminder, RuntimeContext } from './lib/engine/index';
  import { getContextProvider, type ContextProvider, type ContextSample } from './lib/platform/context';
  import { sendSystemNotification } from './lib/platform/notify';
  import { listen } from '@tauri-apps/api/event';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Home from './lib/components/Home.svelte';
  import NewReminder from './lib/components/NewReminder.svelte';
  import Stats from './lib/components/Stats.svelte';
  import Settings from './lib/components/Settings.svelte';
  import BreakOverlay from './lib/components/BreakOverlay.svelte';
  import TrayPopover from './lib/components/TrayPopover.svelte';

  type View = 'home' | 'stats' | 'settings' | 'new';

  let view = $state<View>('home');
  let reminders = $state<Reminder[]>([]);
  let nextFires = $state<Record<string, number>>({});
  let globalPaused = $state(false);
  let trayOpen = $state(false);
  let activeBreak = $state<Reminder | null>(null);
  let clock = $state('');
  let ready = $state(false); // 引擎 boot 完成后才渲染页面，避免 getEngine() 在 boot 前被调用
  let bootError = $state<string | null>(null); // 启动期错误（可见化，避免静默白屏）
  let bootSlow = $state(false); // 启动超过 5s 仍未 ready 的提示
  const firing = new Set<string>();
  const warned = new Set<string>(); // 已发过"预告"的提醒（避免每秒重复通知）
  const breakQueue: Reminder[] = []; // 待弹出的休息队列（多个提醒同时到点不丢失）

  // 系统能力适配层：真实空闲/前台应用/会议信号（Tauri 真机）或 Web 降级
  const provider: ContextProvider = getContextProvider();
  // 最近一次采集到的系统信号，供 UI 观测 + 调试
  let sysCtx = $state<ContextSample>({ isIdle: false, idleSeconds: 0, activeApp: undefined, inMeeting: false });
  let ticking = false; // 防止 1s 循环里 async tick 叠加

  function refresh() {
    reminders = getEngine().list();
  }

  // 休息动作时长（秒）：用于全屏弹窗倒计时演示
  function breakSeconds(r: Reminder): number {
    if (r.mode === 'pomodoro') return r.breakMin * 60;
    if (r.kind === 'eye') return 20;
    return 30;
  }

  async function tick() {
    if (ticking) return; // 上一次 async 采集未完成，跳过本秒，避免叠加
    ticking = true;
    try {
      const now = Date.now();
      clock = getLocal(now).clock;
      // 采集真实系统信号（Tauri 真机 / Web 降级），合并成完整 RuntimeContext
      const sample = await provider.collect(now);
      sysCtx = sample;
      const ctx: RuntimeContext = {
        now,
        ...sample,
        weekday: new Date(now).getDay(),
        clock: getLocal(now).clock,
      };
      const results = getEngine().tick(ctx);
      const nf: Record<string, number> = {};
      for (const res of results) nf[res.reminderId] = res.nextFireAt;
      nextFires = nf;
      for (const res of results) {
        const r = reminders.find((x) => x.id === res.reminderId);
        if (!r) continue;
        // 到点触发：放入队列（避免多个提醒同时到点时，非空 activeBreak 把后续提醒吞掉）
        if (res.fire && !firing.has(res.reminderId)) {
          firing.add(res.reminderId);
          breakQueue.push(r);
          // 并发一条真实系统通知：即使用户在别的窗口也能被提醒
          void sendSystemNotification(r.label, r.message || '该休息一下了');
        } else if (res.warn && !warned.has(res.reminderId)) {
          // 休息前预告（preWarn 闸门生效）：提前给用户留出保存/暂停时间
          warned.add(res.reminderId);
          void sendSystemNotification(
            `${r.label} · 即将提醒`,
            `${Math.ceil((r.gates.warnSeconds || 10))} 秒后开始「${r.label}」`,
          );
        }
        // 一旦不再处于 warn 窗口，重置预告标记，下一周期可再次预告
        if (!res.warn) warned.delete(res.reminderId);
      }
      // 弹出队列中的下一个休息（一次一个，处理完自动接下一个）
      if (!activeBreak && breakQueue.length > 0) {
        activeBreak = breakQueue.shift() ?? null;
      }
    } finally {
      ticking = false;
    }
  }

  // ---- handlers ----
  function go(v: View) {
    view = v;
    trayOpen = false;
  }
  function toggleEnabled(id: string, cur: boolean) {
    getEngine().setEnabled(id, !cur);
    refresh();
  }
  function addReminder(r: Reminder) {
    getEngine().add(r);
    refresh();
    go('home');
  }
  function removeReminder(id: string) {
    getEngine().remove(id);
    refresh();
  }
  function toggleGlobalPause() {
    const now = Date.now();
    if (globalPaused) {
      for (const r of reminders) getEngine().resumeReminder(r.id);
      globalPaused = false;
    } else {
      for (const r of reminders) getEngine().pause(r.id, now + 86400000 * 365);
      globalPaused = true;
    }
    refresh();
  }
  function previewBreak() {
    const r = reminders.find((x) => x.enabled) ?? reminders[0];
    if (r && !firing.has(r.id)) {
      firing.add(r.id);
      breakQueue.push(r);
      if (!activeBreak) activeBreak = breakQueue.shift() ?? null;
    }
  }
  function closeBreak(id: string) {
    firing.delete(id);
    activeBreak = null;
    refresh();
  }
  function onDone(id: string) { getEngine().complete(id); closeBreak(id); }
  function onSnooze(id: string) { getEngine().snooze(id, 5); closeBreak(id); }
  function onSkip(id: string) { getEngine().skip(id); closeBreak(id); }

  onMount(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let unlisten: (() => void) | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;

    // 全局错误可见化：任何未捕获 JS 错误 / promise 拒绝都显示出来
    const onErr = (e: ErrorEvent) => (bootError = `JS 错误：${e.message}`);
    const onReject = (e: PromiseRejectionEvent) =>
      (bootError = `未处理的 Promise 拒绝：${e.reason ? String(e.reason) : '未知'}`);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onReject);

    bootEngine()
      .then(() => {
        refresh();
        tick();
        ready = true;
        timer = setInterval(tick, 1000);
      })
      .catch((e) => {
        bootError = `引擎启动失败：${e?.stack ? e.stack : String(e)}`;
      });
    // 5s 仍未 ready 且无错误：提示可能卡在底层（如 WebView2）
    slowTimer = setTimeout(() => {
      if (!ready && !bootError) bootSlow = true;
    }, 5000);

    // 全局快捷键（仅 Tauri 真机有效；Web 预览不注册，避免无谓建立 tauri 通道）
    if (provider.kind === 'tauri') {
      listen<string>('global-shortcut', (e) => {
        if (e.payload === 'toggle-pause') toggleGlobalPause();
        else if (e.payload === 'skip-break' && activeBreak) onSkip(activeBreak.id);
      })
        .then((u) => (unlisten = u))
        .catch(() => {});
    }
    return () => {
      if (timer) clearInterval(timer);
      if (slowTimer) clearTimeout(slowTimer);
      unlisten?.();
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onReject);
    };
  });
</script>

<div class="appwin">
  <div class="titlebar">
    <div class="traffic"><i class="r"></i><i class="y"></i><i class="g"></i></div>
    <div class="ttl">节奏 Rhythm</div>
    <div class="spacer"></div>
    <button class="tray" title="托盘菜单" onclick={() => (trayOpen = !trayOpen)}>🍃</button>
    <button class="newbtn" onclick={() => go('new')}>+ 新建提醒</button>
  </div>

  {#if ready}
  <div class="body">
    <Sidebar {view} {globalPaused} {go} {toggleGlobalPause} />
    <div class="main">
      {#if view === 'home'}
        <Home {reminders} {nextFires} {clock} {globalPaused} {toggleEnabled} {previewBreak} />
      {:else if view === 'stats'}
        <Stats {reminders} />
      {:else if view === 'settings'}
        <Settings {reminders} />
      {:else if view === 'new'}
        <NewReminder {addReminder} {go} />
      {/if}
    </div>
  </div>

  {#if trayOpen}
    <TrayPopover {nextFires} {reminders} {globalPaused} {go} {toggleGlobalPause} sysCtx={sysCtx} providerKind={provider.kind} />
  {/if}

  {#if activeBreak}
    <BreakOverlay reminder={activeBreak} seconds={breakSeconds(activeBreak)} onDone={() => onDone(activeBreak!.id)} onSnooze={() => onSnooze(activeBreak!.id)} onSkip={() => onSkip(activeBreak!.id)} />
  {/if}
  {:else}
    {#if bootError}
      <div style="padding:24px;color:#c0392b;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;">
        <strong style="font-size:15px;">⚠️ 启动失败</strong><br />{bootError}
      </div>
    {:else}
      <div class="boot">
        正在启动节奏 Rhythm…
        {#if bootSlow}
          <div style="margin-top:10px;color:#888;font-size:12px;max-width:440px;line-height:1.6;">
            启动较慢：若长时间无响应，多半是 Windows 缺少 <b>WebView2 运行库</b>。
            请安装 Microsoft Edge WebView2 Runtime（Evergreen 版）后重试，下载：
            https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
