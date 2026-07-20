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

  // 今日"预计应触发次数"：按各启用提醒已过去的工作时段 / 间隔估算（而非简单用启用数）。
  // 公式：max(0, floor((当前时刻 - 今日工作窗起点) / 间隔分钟))，逐一求和。
  function expectedToday(): number {
    const now = Date.now();
    let total = 0;
    for (const r of reminders) {
      if (!r.enabled) continue;
      const startMs = dayStart(0);
      let from = startMs;
      if (r.workWindow.enabled) {
        const sMin = clockToMinutes(r.workWindow.start);
        const base0 = new Date();
        base0.setHours(0, 0, 0, 0);
        const ws = base0.getTime() + sMin * 60000;
        if (now < ws) continue; // 今天工作窗还没开始
        from = Math.max(from, ws);
      }
      const interval = r.mode === 'pomodoro' ? r.workMin : r.intervalMin;
      total += Math.max(0, Math.floor((now - from) / 60000 / interval));
    }
    return total;
  }

  // 完成率：今日完成 / 今日预计应触发（更贴近真实达成度）
  const completion = $derived.by(() => {
    const exp = expectedToday();
    if (exp <= 0) return todayDone > 0 ? 100 : 0;
    return Math.min(100, Math.round((todayDone / exp) * 100));
  });
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
</div>
