<script lang="ts">
  let { view, globalPaused, go, toggleGlobalPause } = $props();
  const navs = [
    { id: 'home', label: '首页', icon: '🏠' },
    { id: 'stats', label: '统计', icon: '📊' },
    { id: 'settings', label: '设置', icon: '⚙️' },
  ];
</script>

<aside class="sidebar">
  <div class="brand">🌿 节奏</div>
  {#each navs as n}
    <div class="nav {view === n.id ? 'active' : ''}" onclick={() => go(n.id)}>
      <span>{n.icon}</span><span>{n.label}</span>
    </div>
  {/each}
  <div class="spacer"></div>
  <button class="pauseall {globalPaused ? 'on' : ''}" onclick={toggleGlobalPause}>
    {globalPaused ? '▶ 恢复全部' : '⏸ 全局暂停'}
  </button>
</aside>
