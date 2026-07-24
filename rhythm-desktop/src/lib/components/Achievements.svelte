<script lang="ts">
  import { onMount } from 'svelte';
  import { getEngine } from '../store';
  import { BADGES, type AchievementSummary } from '../engine/index';

  // 进入本页即读取一次；之后每 1.5s 轮询，保证"完成提醒"后数字与进度条实时更新
  let summary = $state<AchievementSummary>(getEngine().getAchievements(Date.now()));
  onMount(() => {
    const t = setInterval(() => {
      summary = getEngine().getAchievements(Date.now());
    }, 1500);
    return () => clearInterval(t);
  });

  const pct = (have: number, need: number) => Math.min(100, Math.round((have / need) * 100));
</script>

<div class="greet">
  <div><div class="sub">你的坚持</div><h1>成就墙</h1></div>
  <div class="pill">🏆 {summary.earned.length}/{BADGES.length} 枚徽章</div>
</div>

<div class="hero">
  <div class="flame">🔥</div>
  <div>
    <div class="n">{summary.currentStreak}</div>
    <div class="lbl">当前连续打卡（天）</div>
  </div>
  <div class="sub2">
    <div class="n2">{summary.longestStreak}</div>
    <div class="lbl">最长纪录（天）</div>
  </div>
</div>

<div class="stat-top">
  <div class="c"><div class="big">{summary.todayCount}</div><div class="lbl">今日完成</div></div>
  <div class="c"><div class="big">{summary.totalCompletions}</div><div class="lbl">累计完成</div></div>
  <div class="c"><div class="big">{summary.activeDays}</div><div class="lbl">打卡天数</div></div>
</div>

<div class="sectiontitle">已点亮</div>
{#if summary.earned.length === 0}
  <div class="card muted" style="font-size:13px;">还没有徽章，完成第一次提醒即可点亮 🌱</div>
{:else}
  <div class="ach-grid">
    {#each summary.earned as b (b.id)}
      <div class="ach">
        <div class="ico">{b.icon}</div>
        <div class="meta">
          <div class="t">{b.title}</div>
          <div class="d">{b.desc}</div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<div class="sectiontitle">下个目标</div>
{#if summary.next.length === 0}
  <div class="card muted" style="font-size:13px;">全部徽章已解锁 🎉 你就是节奏大师！</div>
{:else}
  <div class="ach-grid">
    {#each summary.next as n (n.badge.id)}
      <div class="ach off">
        <div class="ico">{n.badge.icon}</div>
        <div class="meta" style="flex:1;">
          <div class="t">{n.badge.title}</div>
          <div class="d">{n.badge.desc}</div>
          <div class="prog"><i style="width:{pct(n.have, n.need)}%"></i></div>
          <div class="d" style="margin-top:4px;">{Math.min(n.have, n.need)} / {n.need}</div>
        </div>
      </div>
    {/each}
  </div>
{/if}
