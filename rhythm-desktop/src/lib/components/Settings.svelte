<script lang="ts">
  import type { Reminder } from '../engine/index';
  interface Props { reminders: Reminder[]; }
  let { reminders }: Props = $props();

  // 设置项（M1 原型：本地可视化开关；接入引擎 gates 见 TDD §3）
  let workWindow = $state(true);
  let lunch = $state(true);
  let idlePause = $state(true);
  let meetingPause = $state(false);
  let whitelist = $state(true);
  let preWarn = $state(true);

  function toggle(key: 'workWindow' | 'lunch' | 'idlePause' | 'meetingPause' | 'whitelist' | 'preWarn') {
    // 简单反射：在真实实现里会写回 engine 对应 reminder.gates / workWindow
    ({
      workWindow, lunch, idlePause, meetingPause, whitelist, preWarn,
    } as Record<string, boolean>)[key] =
      !({
        workWindow, lunch, idlePause, meetingPause, whitelist, preWarn,
      } as Record<string, boolean>)[key];
  }
</script>

<div class="greet">
  <div><div class="sub">偏好设置</div><h1>设置</h1></div>
</div>

<div class="sectiontitle">提醒时段</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">工作时间窗</div><div class="d">仅 09:00 – 18:00 提醒</div></div>
    <div class="switch {workWindow ? 'on' : ''}" onclick={() => toggle('workWindow')}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">午休勿扰</div><div class="d">12:00 – 13:00 不提醒</div></div>
    <div class="switch {lunch ? 'on' : ''}" onclick={() => toggle('lunch')}><i></i></div>
  </div>
</div>

<div class="sectiontitle">智能免打扰（P1 核心 · 见 TDD）</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">空闲自动暂停</div><div class="d">离开座位超 5 分钟暂停</div></div>
    <div class="switch {idlePause ? 'on' : ''}" onclick={() => toggle('idlePause')}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">投屏/会议自动暂停</div><div class="d">演示时不打扰</div></div>
    <div class="switch {meetingPause ? 'on' : ''}" onclick={() => toggle('meetingPause')}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">应用白名单</div><div class="d">前台运行时不弹提醒</div></div>
    <div class="switch {whitelist ? 'on' : ''}" onclick={() => toggle('whitelist')}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">休息前预告</div><div class="d">提前 10 秒预留保存</div></div>
    <div class="switch {preWarn ? 'on' : ''}" onclick={() => toggle('preWarn')}><i></i></div>
  </div>
</div>

<div class="sectiontitle">外观与同步</div>
<div class="card">
  <div class="setrow"><div class="t">主题</div><div class="muted">跟随系统</div></div>
  <div class="setrow"><div class="t">云同步（高级版）</div><div class="muted">未开启</div></div>
  <div class="setrow"><div class="t">关于节奏</div><div class="muted">v0.1.0</div></div>
</div>

<div class="muted" style="font-size:12px;padding:0 4px;">已配置提醒：{reminders.length} 个</div>
