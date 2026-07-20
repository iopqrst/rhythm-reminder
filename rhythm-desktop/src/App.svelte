<script lang="ts">
  import { onMount } from 'svelte';
  import { engine, seedIfEmpty, getLocal } from './lib/store';
  import type { Reminder, RuntimeContext } from './lib/engine/index';
  import { getContextProvider, type ContextProvider, type ContextSample } from './lib/platform/context';
  import { sendSystemNotification } from './lib/platform/notify';
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
  const firing = new Set<string>();

  // 系统能力适配层：真实空闲/前台应用/会议信号（Tauri 真机）或 Web 降级
  const provider: ContextProvider = getContextProvider();
  // 最近一次采集到的系统信号，供 UI 观测 + 调试
  let sysCtx = $state<ContextSample>({ isIdle: false, idleSeconds: 0, activeApp: undefined, inMeeting: false });
  let ticking = false; // 防止 1s 循环里 async tick 叠加

  function refresh() {
    reminders = engine.list();
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
      const results = engine.tick(ctx);
      const nf: Record<string, number> = {};
      for (const res of results) nf[res.reminderId] = res.nextFireAt;
      nextFires = nf;
      for (const res of results) {
        if (res.fire && !firing.has(res.reminderId) && !activeBreak) {
          firing.add(res.reminderId);
          const r = reminders.find((x) => x.id === res.reminderId);
          if (r) {
            activeBreak = r;
            // 并发一条真实系统通知：即使用户在别的窗口也能被提醒
            void sendSystemNotification(r.label, r.message || '该休息一下了');
          }
        }
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
    engine.setEnabled(id, !cur);
    refresh();
  }
  function addReminder(r: Reminder) {
    engine.add(r);
    refresh();
    go('home');
  }
  function removeReminder(id: string) {
    engine.remove(id);
    refresh();
  }
  function toggleGlobalPause() {
    const now = Date.now();
    if (globalPaused) {
      for (const r of reminders) engine.resumeReminder(r.id);
      globalPaused = false;
    } else {
      for (const r of reminders) engine.pause(r.id, now + 86400000 * 365);
      globalPaused = true;
    }
    refresh();
  }
  function previewBreak() {
    const r = reminders.find((x) => x.enabled) ?? reminders[0];
    if (r) {
      activeBreak = r;
      firing.add(r.id);
    }
  }
  function closeBreak(id: string) {
    firing.delete(id);
    activeBreak = null;
    refresh();
  }
  function onDone(id: string) { engine.complete(id); closeBreak(id); }
  function onSnooze(id: string) { engine.snooze(id, 5); closeBreak(id); }
  function onSkip(id: string) { engine.skip(id); closeBreak(id); }

  onMount(() => {
    seedIfEmpty();
    refresh();
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
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
</div>
