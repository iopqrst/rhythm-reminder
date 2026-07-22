<script lang="ts">
  import { getEngine, getLocal } from '../store';
  import { clockToMinutes } from '../engine/index';
  import type { Reminder } from '../engine/index';
  interface Props { reminders: Reminder[]; }
  let { reminders }: Props = $props();

  const week = ['一', '二', '三', '四', '五', '六', '日'];

  // 把某天(本地)的 00:00 epoch 取出来
  function dayStart(offsetDays: number): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - offsetDays * 86400000;
  }

  // 每个提醒今天/近7天的完成次数（基于 lastTriggeredAt 的真实数据）
  function countInRange(fromMs: number, toMs: number): number {
    let n = 0;
    for (const r of reminders) {
      const t = getEngine().getState(r.id)?.lastTriggeredAt;
      if (t && t >= fromMs && t < toMs) n++;
    }
    return n;
  }

  // 近 7 天（周一为索引 0）每天的完成次数
  const daily = $derived.by(() => {
    const arr: number[] = [];
    const todayIdx = (new Date().getDay() + 6) % 7; // 周一=0
    for (let i = 0; i < 7; i++) {
      const from = dayStart(todayIdx - i);
      arr.unshift(countInRange(from, from + 86400000));
    }
    return arr;
  });

  const weekTotal = $derived(daily.reduce((a, b) => a + b, 0));
  const todayDone = $derived(daily[6]);
  const maxDaily = $derived(Math.max(1, ...daily));
  const enabledCount = $derived(reminders.filter((r) => r.enabled).length);

  // 今日"预计应触发次数"：按各启用提醒已过去的工作时段 / 间隔估算。
  // 考虑工作时间窗 + 勿扰时段，更贴近实际应提醒次数。
  function expectedToday(): number {
    const now = Date.now();
    const { weekday, clock } = getLocal(now);
    const curMin = clockToMinutes(clock);
    let total = 0;
    for (const r of reminders) {
      if (!r.enabled) continue;
      const interval = r.mode === 'pomodoro' ? r.workMin : r.intervalMin;
      if (r.workWindow.enabled) {
        // 今天工作窗还没开始 → 0
        const ws = clockToMinutes(r.workWindow.start);
        const we = clockToMinutes(r.workWindow.end);
        if (curMin < ws) continue;
        // 有效工作分钟数 = 今天已过去的工作窗部分 - 勿扰时段扣除
        const effectiveEnd = Math.min(curMin, we);
        let workMin = Math.max(0, effectiveEnd - ws);
        // 扣除勿扰时段中重叠的部分
        for (const q of r.quietWindows ?? []) {
          if (!q.enabled) continue;
          if (q.days && q.days.length > 0 && !q.days.includes(weekday)) continue;
          const qs = clockToMinutes(q.start);
          const qe = clockToMinutes(q.end);
          if (qe <= ws || qs >= effectiveEnd) continue;
          const overlapStart = Math.max(ws, qs);
          const overlapEnd = Math.min(effectiveEnd, qe);
          workMin -= Math.max(0, overlapEnd - overlapStart);
        }
        total += Math.max(0, Math.floor(workMin / interval));
      } else {
        // 无工作窗限制：全天计算，但扣除勿扰时段
        let allMin = curMin;
        for (const q of r.quietWindows ?? []) {
          if (!q.enabled) continue;
          if (q.days && q.days.length > 0 && !q.days.includes(weekday)) continue;
          const qs = clockToMinutes(q.start);
          const qe = clockToMinutes(q.end);
          if (qe <= 0 || qs >= curMin) continue;
          const overlapStart = Math.max(0, qs);
          const overlapEnd = Math.min(curMin, qe);
          allMin -= Math.max(0, overlapEnd - overlapStart);
        }
        total += Math.max(0, Math.floor(allMin / interval));
      }
    }
    return total;
  }

  // 未来 2 小时内预计触发次数
  function expectedNext2H(): number {
    const now = Date.now();
    const { weekday, clock } = getLocal(now);
    const curMin = clockToMinutes(clock);
    const endMin = curMin + 120;
    let total = 0;
    for (const r of reminders) {
      if (!r.enabled) continue;
      const interval = r.mode === 'pomodoro' ? r.workMin : r.intervalMin;
      // 检查不在勿扰时段
      let inQuiet = false;
      for (const q of r.quietWindows ?? []) {
        if (!q.enabled) continue;
        if (q.days && q.days.length > 0 && !q.days.includes(weekday)) continue;
        const qs = clockToMinutes(q.start);
        const qe = clockToMinutes(q.end);
        if (curMin < qe && endMin > qs) { inQuiet = true; break; }
      }
      if (inQuiet) continue;
      // 检查工作窗
      if (r.workWindow.enabled) {
        const ws = clockToMinutes(r.workWindow.start);
        const we = clockToMinutes(r.workWindow.end);
        if (curMin >= we) continue; // 已过工作窗
        const effectiveEnd = Math.min(endMin, we);
        if (effectiveEnd <= Math.max(curMin, ws)) continue;
        const effectiveMin = effectiveEnd - Math.max(curMin, ws);
        total += Math.max(0, Math.floor(effectiveMin / interval));
      } else {
        total += Math.max(0, Math.floor(120 / interval));
      }
    }
    return total;
  }

  // 按提醒统计今日完成次数
  const perReminder = $derived.by(() => {
    const now = Date.now();
    const today0 = dayStart(0);
    return reminders.map((r) => {
      const state = getEngine().getState(r.id);
      const todayCompleted = state?.lastTriggeredAt && state.lastTriggeredAt >= today0 ? 1 : 0;
      const interval = r.mode === 'pomodoro' ? r.workMin : r.intervalMin;
      return { id: r.id, label: r.label, kind: r.kind, todayCompleted, interval, enabled: r.enabled };
    });
  });

  // 完成率：今日完成 / 今日预计应触发（更贴近真实达成度）
  const completion = $derived.by(() => {
    const exp = expectedToday();
    if (exp <= 0) return todayDone > 0 ? 100 : 0;
    return Math.min(100, Math.round((todayDone / exp) * 100));
  });

  const next2H = $derived(expectedNext2H());
  const emoji = (k: string) =>
    k === 'eye' ? '👁️' : k === 'water' ? '💧' : k === 'stand' ? '🧍' : k === 'stretch' ? '🤸' : k === 'medication' ? '💊' : k === 'pomodoro' ? '🍅' : '✏️';
</script>

<div class="greet">
  <div><div class="sub">本周复盘</div><h1>习惯看板</h1></div>
  <div class="pill">📊 真实数据</div>
</div>

<div class="card stat-top">
  <div class="c"><div class="big">{weekTotal}</div><div class="lbl">本周完成次数</div></div>
  <div class="c"><div class="big">{completion}%</div><div class="lbl">今日完成进度</div></div>
</div>

<div class="card">
  <div style="font-weight:600;margin-bottom:6px;">每日完成趋势</div>
  <div class="chart">
    {#each week as d, i}
      <div class="bar {i === 6 ? 'today' : ''}">
        <div class="col" style="height:{Math.round((daily[i] / maxDaily) * 100)}%"></div>
        <div class="day">{d}</div>
      </div>
    {/each}
  </div>
</div>

<div class="muted" style="font-size:12px;padding:0 4px;">
  今天已完成 {todayDone} 次 · 预计应触发 {expectedToday()} 次 · 生效提醒 {enabledCount} 个
  {#if next2H > 0}<br />⏱ 未来 2 小时预计触发 {next2H} 次{/if}
</div>

<div class="sectiontitle" style="margin-top:18px;">按提醒明细</div>
<div class="card">
  {#each perReminder as pr (pr.id)}
    <div class="setrow">
      <div>
        <div class="t">{emoji(pr.kind)} {pr.label}</div>
        <div class="d">{pr.enabled ? `每 ${pr.interval} 分钟 · 今日完成 ${pr.todayCompleted} 次` : '已关闭'}</div>
      </div>
    </div>
  {/each}
</div>
