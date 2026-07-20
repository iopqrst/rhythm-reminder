<script lang="ts">
  import { getEngine, getLocal } from '../store';
  import type { Reminder } from '../engine/index';

  interface Props {
    reminders: Reminder[];
    nextFires: Record<string, number>;
    clock: string;
    globalPaused: boolean;
    toggleEnabled: (id: string, cur: boolean) => void;
    previewBreak: () => void;
  }
  let {
    reminders,
    nextFires,
    clock,
    globalPaused,
    toggleEnabled,
    previewBreak,
  }: Props = $props();

  function isToday(ts?: number): boolean {
    if (!ts) return false;
    return new Date(ts).toDateString() === new Date().toDateString();
  }
  function fmt(ms?: number): string {
    if (!ms) return '--:--';
    return getLocal(ms).clock;
  }

  const todayDone = $derived(
    reminders.filter((r) => isToday(getEngine().getState(r.id)?.lastTriggeredAt)).length,
  );
  const enabledCount = $derived(reminders.filter((r) => r.enabled).length);
  const pct = $derived(Math.min(95, enabledCount === 0 ? 0 : 40 + todayDone * 18));
  const ringOffset = $derived(289 - (289 * pct) / 100);
</script>

<div class="greet">
  <div>
    <div class="sub">周一 · 现在 {clock}</div>
    <h1>你的节奏</h1>
  </div>
  <div class="pill">🌿 健康模式</div>
</div>

<div class="card">
  <div class="ringwrap">
    <div class="ring">
      <svg viewBox="0 0 104 104" width="104" height="104">
        <circle cx="52" cy="52" r="46" fill="none" stroke="#e8ecf2" stroke-width="10" />
        <circle cx="52" cy="52" r="46" fill="none" stroke="#12b886" stroke-width="10"
          stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset={ringOffset}
          transform="rotate(-90 52 52)" />
      </svg>
      <div class="num"><b>{pct}%</b><span>今日完成</span></div>
    </div>
    <div>
      <div style="font-weight:700;font-size:15px;">今天已守护 {todayDone} 次</div>
      <div class="muted" style="margin-top:4px;">生效中 {enabledCount} 个提醒</div>
      <div class="muted" style="margin-top:6px;">{globalPaused ? '⏸ 已全局暂停' : '🔥 持续守护中'}</div>
    </div>
  </div>
</div>

<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 4px 8px;">
  <b style="font-size:15px;">我的提醒</b>
  <span class="muted">共 {reminders.length} 个</span>
</div>

{#each reminders as r (r.id)}
  <div class="remind">
    <div class="ico">{r.kind === 'eye' ? '👁️' : r.kind === 'water' ? '💧' : r.kind === 'stand' ? '🧍' : r.kind === 'stretch' ? '🤸' : r.kind === 'medication' ? '💊' : r.kind === 'pomodoro' ? '🍅' : '✏️'}</div>
    <div class="body">
      <div class="t">{r.label}</div>
      <div class="d">{r.mode === 'pomodoro' ? `专注 ${r.workMin} / 休息 ${r.breakMin} 分` : `每 ${r.intervalMin} 分钟`}</div>
    </div>
    <div class="next">{fmt(nextFires[r.id])}<br />{r.enabled ? '启用' : '关闭'}</div>
    <div class="switch {r.enabled ? 'on' : ''}" onclick={() => toggleEnabled(r.id, r.enabled)}><i></i></div>
  </div>
{/each}

<button class="preview-btn" onclick={previewBreak}>▶ 预览「提醒弹窗」效果</button>
