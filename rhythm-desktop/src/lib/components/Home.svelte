<script lang="ts">
  import { getEngine, getLocal } from '../store';
  import type { Reminder } from '../engine/index';

  interface Props {
    reminders: Reminder[];
    nextFires: Record<string, number>;
    clock: string;
    globalPaused: boolean;
    toggleEnabled: (id: string, cur: boolean) => void;
    removeReminder: (id: string) => void;
    previewBreak: () => void;
  }
  let {
    reminders,
    nextFires,
    clock,
    globalPaused,
    toggleEnabled,
    removeReminder,
    previewBreak,
  }: Props = $props();

  // 删除确认弹窗状态
  let deleting = $state<Reminder | null>(null);

  function isToday(ts?: number): boolean {
    if (!ts) return false;
    return new Date(ts).toDateString() === new Date().toDateString();
  }
  function fmt(ms?: number): string {
    if (!ms) return '--:--';
    return getLocal(ms).clock;
  }

  /** 清理标签中的冗余 emoji（图标已表达语义，文字不再重复） */
  function cleanLabel(raw: string): string {
    return raw.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F5}\u{26F9}-\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}]/gu, '').trim();
  }

  const todayDone = $derived(
    reminders.filter((r) => isToday(getEngine().getState(r.id)?.lastTriggeredAt)).length,
  );
  const enabledCount = $derived(reminders.filter((r) => r.enabled).length);
  // 真实完成率：今日已完成 / 今日预计触发次数（按各提醒工作窗内时长/间隔估算）
  const todayExpected = $derived(() => {
    let sum = 0;
    for (const r of reminders) {
      if (!r.enabled) continue;
      if (r.mode === 'pomodoro') { sum += Math.max(1, Math.floor(480 / (r.workMin + r.breakMin))); continue; }
      const min = r.intervalMin || 30;
      sum += Math.max(1, Math.floor(480 / min)); // 按 8h 工作日估算
    }
    return sum || 1;
  });
  const pct = $derived(Math.round((todayDone / todayExpected()) * 100));
  const ringOffset = $derived(289 - (289 * Math.min(pct, 100)) / 100);

  function confirmDelete() {
    if (deleting) {
      removeReminder(deleting.id);
      deleting = null;
    }
  }
</script>

<div class="greet">
  <div>
    <div class="sub">{['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()]} · 现在 {clock}</div>
    <h1>你的节奏</h1>
  </div>
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
      <div class="muted" style="margin-top:6px;">预计今日触发 {todayExpected()} 次</div>
      <div class="muted" style="margin-top:6px;">{globalPaused ? '⏸ 已全局暂停' : '🔥 持续守护中'}</div>
    </div>
  </div>
</div>

<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 4px 8px;">
  <b style="font-size:15px;">我的提醒</b>
  <span class="muted">共 {reminders.length} 个</span>
</div>

{#each reminders as r (r.id)}
  <div class="remind" data-id={r.id}>
    <div class="ico">{r.kind === 'eye' ? '👁️' : r.kind === 'water' ? '💧' : r.kind === 'stand' ? '🧍' : r.kind === 'stretch' ? '🤸' : r.kind === 'medication' ? '💊' : r.kind === 'pomodoro' ? '🍅' : '✏️'}</div>
    <div class="body">
      <div class="t">{cleanLabel(r.label)}</div>
      <div class="d">{r.mode === 'pomodoro' ? `专注 ${r.workMin} / 休息 ${r.breakMin} 分` : `每 ${r.intervalMin} 分钟`}</div>
    </div>
    <div class="meta">
      <span class="next-time">{fmt(nextFires[r.id])}</span>
      <span class="status-dot {r.enabled ? 'on' : ''}"></span>
      <span class="status-text">{r.enabled ? '启用' : '关闭'}</span>
    </div>
    <!-- 开关 -->
    <div class="switch {r.enabled ? 'on' : ''}" onclick={() => toggleEnabled(r.id, r.enabled)}><i></i></div>
    <!-- 删除按钮：悬停显示 -->
    <button class="del-btn" onclick={(e) => { e.stopPropagation(); deleting = r; }} title="删除此提醒">✕</button>
  </div>
{/each}

<button class="preview-btn" onclick={previewBreak}>▶ 预览「提醒弹窗」效果</button>

<!-- 删除确认弹窗 -->
{#if deleting}
  <div class="confirm-overlay" onclick={() => deleting = null}>
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="confirm-title">确认删除「{cleanLabel(deleting.label)}」？</div>
      <div class="confirm-sub">删除后不可恢复，相关数据将被清除。</div>
      <div class="confirm-acts">
        <button class="confirm-cancel" onclick={() => deleting = null}>取消</button>
        <button class="confirm-ok" onclick={confirmDelete}>确认删除</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .greet {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 18px;
  }
  .greet .sub { font-size: 13px; color: var(--sub); margin-bottom: 4px; }
  .greet h1 { font-size: 22px; font-weight: 800; margin: 0; }

  /* 提醒行 */
  .remind {
    position: relative;
    display: flex; align-items: center; gap: 12px;
    padding: 14px 16px; background: var(--panel); border-radius: 14px;
    margin-bottom: 12px; box-shadow: var(--shadow);
  }
  .remind:hover .del-btn { opacity: 1; pointer-events: auto; }

  /* 删除按钮 */
  .del-btn {
    position: absolute; top: 8px; right: 8px;
    width: 24px; height: 24px; border-radius: 50%;
    border: none; background: #fde8e8; color: #c0392b;
    font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    opacity: 0; pointer-events: none; transition: .15s; line-height: 1;
    z-index: 2;
  }
  .del-btn:hover { background: #c0392b; color: #fff; }

  /* 右侧元信息优化 */
  .meta {
    display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
    flex: none; min-width: 56px;
  }
  .next-time { font-size: 13px; font-weight: 600; color: var(--ink); }
  .status-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #d6dde8; display: inline-block;
  }
  .status-dot.on { background: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .status-text { font-size: 11px; color: var(--sub); }

  /* 确认弹窗 */
  .confirm-overlay {
    position: fixed; inset: 0; background: rgba(20,30,50,.35); z-index: 50;
    display: flex; align-items: center; justify-content: center;
  }
  .confirm-dialog {
    background: #fff; border-radius: 16px; padding: 24px; width: 340px; max-width: 90vw;
    box-shadow: 0 20px 50px rgba(20,30,50,.2);
  }
  .confirm-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .confirm-sub { font-size: 13px; color: var(--sub); margin-bottom: 20px; line-height: 1.5; }
  .confirm-acts { display: flex; gap: 10px; }
  .confirm-cancel {
    flex: 1; border: 1.5px solid var(--line); border-radius: 10px; padding: 11px 0;
    font-size: 14px; cursor: pointer; background: #fff; color: var(--ink); font-weight: 500;
  }
  .confirm-ok {
    flex: 1; border: none; border-radius: 10px; padding: 11px 0;
    font-size: 14px; cursor: pointer; background: #c0392b; color: #fff; font-weight: 600;
  }
  .confirm-ok:hover { opacity: .9; }
</style>
