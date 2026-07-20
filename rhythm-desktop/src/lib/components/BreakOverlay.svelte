<script lang="ts">
  import { onMount } from 'svelte';
  import type { Reminder } from '../engine/index';
  import { playSound } from '../platform/sound';

  interface Props {
    reminder: Reminder;
    seconds: number;
    onDone: () => void;
    onSnooze: () => void;
    onSkip: () => void;
  }
  let {
    reminder,
    seconds,
    onDone,
    onSnooze,
    onSkip,
  }: Props = $props();

  let left = $state(seconds);
  const total = seconds;
  const offset = $derived(565 - (565 * left) / total);
  // 严格模式：必须"完成"，隐藏跳过/延后
  const strict = $derived(reminder.gates.strictMode);

  onMount(() => {
    // 弹窗出现即播放所选提示音（覆盖真实触发与预览两种入口）
    playSound(reminder.sound);
    const t = setInterval(() => {
      left = left - 1;
      if (left <= 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  });

  const emoji =
    reminder.kind === 'eye' ? '👁️' : reminder.kind === 'water' ? '💧' : reminder.kind === 'stand' ? '🧍' : reminder.kind === 'stretch' ? '🤸' : reminder.kind === 'medication' ? '💊' : reminder.kind === 'pomodoro' ? '🍅' : '🌿';
</script>

<div class="overlay">
  <div class="label">{reminder.label} · 提醒</div>
  <div class="break-emoji">{emoji}</div>
  <div class="cd">
    <svg viewBox="0 0 200 200" width="200" height="200">
      <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="10" />
      <circle cx="100" cy="100" r="90" fill="none" stroke="#fff" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="565" stroke-dashoffset={offset}
        transform="rotate(-90 100 100)" />
    </svg>
    <div class="ct"><b>{left}</b><span>秒</span></div>
  </div>
  <div class="break-text">{reminder.message}</div>
  <div class="acts">
    <button class="done" onclick={onDone}>完成 ✓</button>
    {#if !strict}
      <button class="snooze" onclick={onSnooze}>延后 5′</button>
      <button class="skip" onclick={onSkip}>跳过</button>
    {:else}
      <div class="strict-hint">🔒 严格模式：需完成本项</div>
    {/if}
  </div>
</div>
