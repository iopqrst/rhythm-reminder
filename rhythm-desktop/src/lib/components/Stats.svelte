<script lang="ts">
  import type { Reminder } from '../engine/index';
  interface Props { reminders: Reminder[]; }
  let { reminders }: Props = $props();

  const week = ['一', '二', '三', '四', '五', '六', '日'];
  const heights = [42, 60, 55, 78, 70, 88, 30];
  const enabledCount = $derived(reminders.filter((r) => r.enabled).length);
</script>

<div class="greet">
  <div><div class="sub">本周复盘</div><h1>习惯看板</h1></div>
  <div class="pill">🔥 12 天连胜</div>
</div>

<div class="card stat-top">
  <div class="c"><div class="big">86</div><div class="lbl">本周完成次数</div></div>
  <div class="c"><div class="big">91%</div><div class="lbl">提醒完成率</div></div>
</div>

<div class="card">
  <div style="font-weight:600;margin-bottom:6px;">每日完成趋势</div>
  <div class="chart">
    {#each week as d, i}
      <div class="bar {i === 5 ? 'today' : ''}">
        <div class="col" style="height:{heights[i]}%"></div>
        <div class="day">{d}</div>
      </div>
    {/each}
  </div>
</div>

<div class="card">
  <div style="font-weight:600;margin-bottom:10px;">成就徽章</div>
  <div class="badges">
    <div class="badge">👁️</div>
    <div class="badge">💧</div>
    <div class="badge">🏅</div>
    <div class="badge off">🌟</div>
    <div class="badge off">🔥</div>
  </div>
</div>

<div class="muted" style="font-size:12px;padding:0 4px;">当前生效提醒：{enabledCount} 个</div>
