<script lang="ts">
  import { getEngine } from '../store';
  import type { Reminder } from '../engine/index';
  interface Props { reminders: Reminder[]; }
  let { reminders }: Props = $props();

  // 设置项直接读写引擎：workWindow / idlePause / meetingPause / appWhitelist / preWarn / strictMode / quietWindows。
  // M1 仍采用"全局策略"——对全部提醒统一应用同一组开关（后续可按单个提醒细化）。

  // ---- 聚合读取（随 reminders 变化自动刷新）----
  const workWindow = $derived(reminders.some((r) => r.workWindow.enabled));
  const idlePause = $derived(reminders.some((r) => r.gates.idlePause));
  const meetingPause = $derived(reminders.some((r) => r.gates.meetingPause));
  const preWarn = $derived(reminders.some((r) => r.gates.preWarn));
  const strict = $derived(reminders.some((r) => r.gates.strictMode));
  const whitelistOn = $derived(reminders.some((r) => r.gates.appWhitelist.length > 0));
  const wlEntries = $derived([
    ...new Set(reminders.flatMap((r) => r.gates.appWhitelist.map((a) => a.trim()).filter(Boolean))),
  ]);
  const lunchOn = $derived(reminders.some((r) => (r.quietWindows ?? []).some((w) => w.enabled)));

  // ---- 编辑态 ----
  let wlInput = $state('');
  let lunchStart = $state('12:00');
  let lunchEnd = $state('13:00');

  function applyAll(mutate: (r: Reminder) => void) {
    for (const r of reminders) {
      mutate(r);
      getEngine().update(r);
    }
  }

  // 工作时间窗
  function toggleWorkWindow() {
    const target = !workWindow;
    applyAll((r) => (r.workWindow.enabled = target));
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

  // ---- 午休勿扰（多时段）----
  function toggleLunch() {
    const target = !lunchOn;
    applyAll((r) => {
      r.quietWindows = r.quietWindows ?? [];
      if (target) {
        r.quietWindows = [{ enabled: true, start: lunchStart, end: lunchEnd, days: [1, 2, 3, 4, 5] }];
      } else {
        r.quietWindows = r.quietWindows.map((w) => ({ ...w, enabled: false }));
      }
    });
  }
</script>

<div class="greet">
  <div><div class="sub">偏好设置</div><h1>设置</h1></div>
</div>

<div class="sectiontitle">提醒时段</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">工作时间窗</div><div class="d">仅 09:00 – 18:00 提醒</div></div>
    <div class="switch {workWindow ? 'on' : ''}" onclick={toggleWorkWindow}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">午休勿扰</div><div class="d">指定时段内不提醒（如 12:00–13:00）</div></div>
    <div class="switch {lunchOn ? 'on' : ''}" onclick={toggleLunch}><i></i></div>
  </div>
  {#if lunchOn}
    <div class="timeedit">
      <label>起</label><input value={lunchStart} oninput={(e) => (lunchStart = e.currentTarget.value)} placeholder="12:00" />
      <label>止</label><input value={lunchEnd} oninput={(e) => (lunchEnd = e.currentTarget.value)} placeholder="13:00" />
      <span class="muted">修改后关闭再打开以生效</span>
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
