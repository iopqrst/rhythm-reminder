<script lang="ts">
  import { getEngine } from '../store';
  import type { Reminder } from '../engine/index';
  interface Props { reminders: Reminder[]; }
  let { reminders }: Props = $props();

  // 设置项直接读写引擎：workWindow / idlePause / meetingPause / appWhitelist / preWarn / strictMode / quietWindows。
  // 支持"全局"与"按提醒"两种配置模式。

  // ---- 配置模式 ----
  let configMode = $state<'all' | 'single'>('all');
  let selectedId = $state<string | null>(null);

  // 当前生效的提醒列表（按模式过滤）
  const targetReminders = $derived.by(() => {
    if (configMode === 'single' && selectedId) {
      const r = reminders.find((x) => x.id === selectedId);
      return r ? [r] : reminders;
    }
    return reminders;
  });

  const selectedLabel = $derived.by(() => {
    if (configMode !== 'single' || !selectedId) return '';
    return reminders.find((x) => x.id === selectedId)?.label ?? '';
  });

  // ---- 聚合读取（根据模式读取全局或单个提醒）----
  const workWindow = $derived(targetReminders.some((r) => r.workWindow.enabled));
  // 从第一个启用 workWindow 的提醒中读取时间
  const wwSample = $derived(targetReminders.find((r) => r.workWindow.enabled));
  const workStart = $derived(wwSample?.workWindow.start ?? '09:00');
  const workEnd = $derived(wwSample?.workWindow.end ?? '18:00');
  const idlePause = $derived(targetReminders.some((r) => r.gates.idlePause));
  const meetingPause = $derived(targetReminders.some((r) => r.gates.meetingPause));
  const preWarn = $derived(targetReminders.some((r) => r.gates.preWarn));
  const strict = $derived(targetReminders.some((r) => r.gates.strictMode));
  const whitelistOn = $derived(targetReminders.some((r) => r.gates.appWhitelist.length > 0));
  const wlEntries = $derived([
    ...new Set(targetReminders.flatMap((r) => r.gates.appWhitelist.map((a) => a.trim()).filter(Boolean))),
  ]);
  const lunchOn = $derived(targetReminders.some((r) => (r.quietWindows ?? []).some((w) => w.enabled)));

  // 从提醒数据中聚合勿扰时段列表（去重）
  const lunchWindows = $derived.by(() => {
    const all = targetReminders.flatMap((r) => r.quietWindows ?? []);
    // 按 start+end 去重
    const seen = new Set<string>();
    return all.filter((w) => {
      const key = `${w.start}|${w.end}|${JSON.stringify(w.days ?? [])}`;
      if (seen.has(key) || !w.enabled) return false;
      seen.add(key);
      return true;
    });
  });

  // ---- 编辑态 ----
  let wlInput = $state('');

  function applyAll(mutate: (r: Reminder) => void) {
    for (const r of targetReminders) {
      mutate(r);
      getEngine().update(r);
    }
  }

  // 工作时间窗
  function toggleWorkWindow() {
    const target = !workWindow;
    applyAll((r) => (r.workWindow.enabled = target));
  }
  function updateWorkWindow(field: 'start' | 'end', value: string) {
    applyAll((r) => {
      if (r.workWindow.enabled) {
        r.workWindow = { ...r.workWindow, [field]: value };
      }
    });
  }
  // 空闲自动暂停
  function toggleIdlePause() {
    const target = !idlePause;
    applyAll((r) => (r.gates.idlePause = target));
  }
  // 会议自动暂停
  function toggleMeetingPause() {
    const target = !meetingPause;
    applyAll((r) => (r.gates.meetingPause = target));
  }
  // 休息前预告
  function togglePreWarn() {
    const target = !preWarn;
    applyAll((r) => (r.gates.preWarn = target));
  }
  // 严格模式
  function toggleStrict() {
    const target = !strict;
    applyAll((r) => (r.gates.strictMode = target));
  }

  // ---- 应用白名单（可编辑）----
  function toggleWhitelist() {
    const target = !whitelistOn;
    applyAll((r) =>
      r.gates.appWhitelist = target ? ['powerpnt', 'keynote', 'wps', 'obsidian'] : [],
    );
  }
  function addWl() {
    const v = wlInput.trim();
    if (!v) return;
    const key = v.toLowerCase();
    applyAll((r) => {
      if (!r.gates.appWhitelist.some((a) => a.trim().toLowerCase() === key)) {
        r.gates.appWhitelist = [...r.gates.appWhitelist, v];
      }
    });
    wlInput = '';
  }
  function removeWl(item: string) {
    const key = item.toLowerCase();
    applyAll((r) => (r.gates.appWhitelist = r.gates.appWhitelist.filter((a) => a.trim().toLowerCase() !== key)));
  }

  // ---- 午休勿扰（多时段，读写实际提醒数据）----
  function toggleLunch() {
    const target = !lunchOn;
    if (target && lunchWindows.length === 0) {
      // 首次启用时新增一个默认午休窗
      applyAll((r) => {
        r.quietWindows = r.quietWindows ?? [];
        r.quietWindows.push({ enabled: true, start: '12:00', end: '13:00', days: [1, 2, 3, 4, 5] });
      });
    } else {
      applyAll((r) => {
        r.quietWindows = (r.quietWindows ?? []).map((w) => ({ ...w, enabled: target }));
      });
    }
  }

  // 添加一个新的勿扰时段
  function addLunchWindow() {
    applyAll((r) => {
      r.quietWindows = r.quietWindows ?? [];
      // 确保至少一个启用，否则 toggle 会重新启用全部
      r.quietWindows.push({ enabled: true, start: '12:00', end: '13:00', days: [1, 2, 3, 4, 5] });
    });
  }

  // 更新某个勿扰时段（根据 start+end 匹配）
  function updateLunchWindow(idx: number, field: 'start' | 'end', value: string) {
    const ref = lunchWindows[idx];
    if (!ref) return;
    const oldKey = `${ref.start}|${ref.end}`;
    applyAll((r) => {
      r.quietWindows = (r.quietWindows ?? []).map((w) => {
        const wk = `${w.start}|${w.end}`;
        if (wk !== oldKey) return w;
        return { ...w, [field]: value };
      });
    });
  }

  // 删除某个勿扰时段
  function removeLunchWindow(idx: number) {
    const ref = lunchWindows[idx];
    if (!ref) return;
    const oldKey = `${ref.start}|${ref.end}`;
    applyAll((r) => {
      r.quietWindows = (r.quietWindows ?? []).filter((w) => {
        const wk = `${w.start}|${w.end}`;
        return wk !== oldKey;
      });
    });
    // 如果删完了，自动关掉午休勿扰
    if (lunchWindows.length <= 1) {
      applyAll((r) => {
        r.quietWindows = r.quietWindows?.map((w) => ({ ...w, enabled: false })) ?? [];
      });
    }
  }
</script>

<div class="greet">
  <div><div class="sub">偏好设置</div><h1>设置</h1></div>
</div>

<div class="card">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
    <div style="font-weight:600;">配置范围</div>
    <div class="chips" style="margin:0;">
      <div class="chip {configMode === 'all' ? 'sel' : ''}" onclick={() => (configMode = 'all')}>
        🌐 全局
      </div>
      <div class="chip {configMode === 'single' ? 'sel' : ''}" onclick={() => (configMode = 'single')}>
        🎯 按提醒
      </div>
    </div>
  </div>
  {#if configMode === 'single'}
    <div class="chips" style="margin-top:8px;">
      {#each reminders as r (r.id)}
        <div class="chip {selectedId === r.id ? 'sel' : ''}" onclick={() => (selectedId = r.id)}>
          {r.kind === 'eye' ? '👁️' : r.kind === 'water' ? '💧' : r.kind === 'stand' ? '🧍' : r.kind === 'stretch' ? '🤸' : r.kind === 'medication' ? '💊' : r.kind === 'pomodoro' ? '🍅' : '✏️'}
          {r.label}
        </div>
      {/each}
    </div>
    {#if selectedLabel}
      <div class="muted" style="margin-top:6px;font-size:12px;">当前配置仅影响「{selectedLabel}」的提醒设置</div>
    {/if}
  {/if}
</div>

<div class="sectiontitle">提醒时段</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">工作时间窗</div><div class="d">仅 {workStart} – {workEnd} 提醒</div></div>
    <div class="switch {workWindow ? 'on' : ''}" onclick={toggleWorkWindow}><i></i></div>
  </div>
  {#if workWindow}
    <div class="timeedit">
      <label>起</label><input value={workStart} oninput={(e) => updateWorkWindow('start', e.currentTarget.value)} placeholder="09:00" />
      <label>止</label><input value={workEnd} oninput={(e) => updateWorkWindow('end', e.currentTarget.value)} placeholder="18:00" />
    </div>
  {/if}
  <div class="setrow">
    <div><div class="t">午休勿扰</div><div class="d">指定时段内不提醒（如 12:00–13:00）</div></div>
    <div class="switch {lunchOn ? 'on' : ''}" onclick={toggleLunch}><i></i></div>
  </div>
  {#if lunchOn}
    {#each lunchWindows as lw, i (i)}
      <div class="timeedit" style="margin-top:8px;">
        <label>{lunchWindows.length > 1 ? `时段${i + 1}` : '午休'}</label>
        <input value={lw.start} oninput={(e) => updateLunchWindow(i, 'start', e.currentTarget.value)} placeholder="12:00" />
        <label>—</label>
        <input value={lw.end} oninput={(e) => updateLunchWindow(i, 'end', e.currentTarget.value)} placeholder="13:00" />
        <button class="wl-x" style="margin-left:6px;padding:2px 6px;border:1px solid #ddd;border-radius:4px;background:transparent;cursor:pointer;"
          onclick={() => removeLunchWindow(i)} title="移除此时段">×</button>
      </div>
    {/each}
    <div class="muted" style="margin-top:6px;font-size:12px;cursor:pointer;display:inline-block;" onclick={addLunchWindow}>
      ＋ 添加勿扰时段
    </div>
  {/if}
</div>

<div class="sectiontitle">智能免打扰（已接通引擎）</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">空闲自动暂停</div><div class="d">离开座位超 5 分钟暂停</div></div>
    <div class="switch {idlePause ? 'on' : ''}" onclick={toggleIdlePause}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">投屏/会议自动暂停</div><div class="d">演示时不打扰</div></div>
    <div class="switch {meetingPause ? 'on' : ''}" onclick={toggleMeetingPause}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">休息前预告</div><div class="d">提前 10 秒预留保存</div></div>
    <div class="switch {preWarn ? 'on' : ''}" onclick={togglePreWarn}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">严格模式</div><div class="d">到点必须完成，隐藏跳过/延后</div></div>
    <div class="switch {strict ? 'on' : ''}" onclick={toggleStrict}><i></i></div>
  </div>
</div>

<div class="sectiontitle">应用白名单（前台运行时免打扰）</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">启用白名单</div><div class="d">命中以下应用则不弹提醒</div></div>
    <div class="switch {whitelistOn ? 'on' : ''}" onclick={toggleWhitelist}><i></i></div>
  </div>
  <div class="wl-add">
    <input placeholder="如 powerpnt、wps、obsidian" bind:value={wlInput} onkeydown={(e) => e.key === 'Enter' && addWl()} />
    <button class="wl-btn" onclick={addWl}>添加</button>
  </div>
  {#if wlEntries.length}
    <div class="wl-list">
      {#each wlEntries as item}
        <span class="wl-chip">{item}<button class="wl-x" onclick={() => removeWl(item)}>×</button></span>
      {/each}
    </div>
  {:else}
    <div class="muted" style="font-size:12px;">暂无条目，开启后可添加前台应用名</div>
  {/if}
  <div class="muted" style="font-size:12px;">匹配为"包含"模糊（不区分大小写），如 POWERPNT.EXE 会命中 powerpnt</div>
</div>

<div class="sectiontitle">外观与同步</div>
<div class="card">
  <div class="setrow"><div class="t">主题</div><div class="muted">跟随系统</div></div>
  <div class="setrow"><div class="t">云同步（高级版）</div><div class="muted">未开启</div></div>
  <div class="setrow"><div class="t">关于节奏</div><div class="muted">v0.1.0</div></div>
</div>

<div class="muted" style="font-size:12px;padding:0 4px;">已配置提醒：{reminders.length} 个 · 开关即时生效并写回引擎</div>
