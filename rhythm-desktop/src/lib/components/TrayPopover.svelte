<script lang="ts">
  import { onMount } from 'svelte';
  import { getLocal } from '../store';
  import type { Reminder } from '../engine/index';
  import type { ContextSample } from '../platform/context';

  interface Props {
    nextFires: Record<string, number>;
    reminders: Reminder[];
    globalPaused: boolean;
    go: (v: string) => void;
    toggleGlobalPause: () => void;
    sysCtx?: ContextSample;
    providerKind?: 'tauri' | 'web';
  }
  let {
    nextFires,
    reminders,
    globalPaused,
    go,
    toggleGlobalPause,
    sysCtx,
    providerKind = 'web',
  }: Props = $props();

  // 系统信号摘要（可观测：验证免打扰闸门是否被真实信号驱动）
  const sysLine = $derived.by(() => {
    if (!sysCtx) return '';
    const parts: string[] = [];
    if (sysCtx.isIdle) parts.push(`空闲 ${sysCtx.idleSeconds}s`);
    else parts.push('活跃');
    if (sysCtx.inMeeting) parts.push('会议中');
    if (sysCtx.activeApp) parts.push(sysCtx.activeApp);
    return parts.join(' · ');
  });

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const next = $derived.by(() => {
    const enabled = reminders.filter((r) => r.enabled);
    if (enabled.length === 0) return null;
    let best: { r: Reminder; at: number } | null = null;
    for (const r of enabled) {
      const at = nextFires[r.id];
      if (at && (!best || at < best.at)) best = { r, at };
    }
    return best;
  });

  const countdown = $derived(next ? Math.max(0, Math.round((next.at - now) / 1000)) : 0);
  const mm = $derived(String(Math.floor(countdown / 60)).padStart(2, '0'));
  const ss = $derived(String(countdown % 60).padStart(2, '0'));
</script>

<div class="popover">
  <div style="font-weight:700;font-size:14px;">🌿 节奏</div>
  <div class="cd">{mm}:{ss}</div>
  <div class="sub">
    {globalPaused ? '已全局暂停' : next ? `下次：${next.r.label} · ${getLocal(next.at).clock}` : '暂无生效提醒'}
  </div>
  <div class="row">
    <button class="open" onclick={() => go('home')}>打开</button>
    <button class="pp" onclick={toggleGlobalPause}>{globalPaused ? '恢复' : '暂停'}</button>
  </div>
  <div class="sys" title="系统信号来源：{providerKind === 'tauri' ? '真机采集' : 'Web 降级'}">
    <span class="dot" class:live={providerKind === 'tauri'}></span>
    {providerKind === 'tauri' ? '真机' : 'Web'} · {sysLine || '采集中…'}
  </div>
</div>
