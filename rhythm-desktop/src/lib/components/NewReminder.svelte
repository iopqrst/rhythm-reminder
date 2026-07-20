<script lang="ts">
  import { createReminderFromTemplate, type Reminder, type ReminderKind, type SoundName } from '../engine/index';

  interface Props {
    addReminder: (r: Reminder) => void;
    go: (v: string) => void;
  }
  let { addReminder, go }: Props = $props();

  let kind = $state<ReminderKind>('eye');
  let interval = $state(20);
  let message = $state('看看远处，放松双眼 20 秒');
  let sound = $state<SoundName>('bell');

  const templates: { k: ReminderKind; e: string; label: string }[] = [
    { k: 'eye', e: '👁️', label: '护眼' },
    { k: 'water', e: '💧', label: '喝水' },
    { k: 'stand', e: '🧍', label: '起身' },
    { k: 'stretch', e: '🤸', label: '拉伸' },
    { k: 'medication', e: '💊', label: '服药' },
    { k: 'pomodoro', e: '🍅', label: '番茄' },
    { k: 'custom', e: '✏️', label: '自定义' },
  ];
  const sounds: SoundName[] = ['bell', 'wave', 'wood', 'silent'];

  function pickTemplate(k: ReminderKind) {
    kind = k;
    const t = createReminderFromTemplate(k);
    interval = t.intervalMin;
    message = t.message;
  }
  function step(d: number) {
    interval = Math.max(1, Math.min(1440, interval + d));
  }
  function save() {
    const r = createReminderFromTemplate(kind);
    r.intervalMin = interval;
    r.message = message;
    r.sound = sound;
    addReminder(r);
  }
</script>

<div class="greet">
  <div><div class="sub">新建提醒</div><h1>添加节奏</h1></div>
</div>

<div class="card">
  <label class="muted" style="font-size:13px;">选择场景模板</label>
  <div class="chips">
    {#each templates as t}
      <div class="chip {kind === t.k ? 'sel' : ''}" onclick={() => pickTemplate(t.k)}>
        <span class="e">{t.e}</span>{t.label}
      </div>
    {/each}
  </div>
</div>

<div class="card">
  <div style="font-weight:600;margin-bottom:4px;">提醒间隔</div>
  <div class="stepper">
    <button class="btnround" onclick={() => step(-5)}>−</button>
    <div class="val">{interval}<small> 分钟</small></div>
    <button class="btnround" onclick={() => step(5)}>+</button>
  </div>
  <div class="chips" style="margin-top:10px;">
    <div class="chip" onclick={() => (interval = 20)}>20</div>
    <div class="chip" onclick={() => (interval = 45)}>45</div>
    <div class="chip" onclick={() => (interval = 60)}>60</div>
    <div class="chip" onclick={() => (interval = 90)}>90</div>
  </div>
  <div class="field">
    <label>提醒文案</label>
    <input bind:value={message} />
  </div>
  <div class="field">
    <label>提示音</label>
    <div class="sounds">
      {#each sounds as s}
        <div class="s {sound === s ? 'sel' : ''}" onclick={() => (sound = s)}>
          {s === 'bell' ? '🔔 轻柔铃' : s === 'wave' ? '🌊 海浪' : s === 'wood' ? '🎵 木鱼' : '🔕 静音'}
        </div>
      {/each}
    </div>
  </div>
</div>

<button class="primary-btn" onclick={save}>保存并启用</button>
<button class="ghost-btn" onclick={() => go('home')}>取消</button>
