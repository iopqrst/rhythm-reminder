<script lang="ts">
  import { getEngine } from '../store';
  import type { Reminder } from '../engine/index';
  interface Props { reminders: Reminder[]; }
  let { reminders }: Props = $props();

  // 设置项直接读写引擎：workWindow / idlePause / meetingPause / appWhitelist / preWarn。
  // 说明：午休勿扰（lunch）需要"多时间段"模型，当前引擎 workWindow 只支持单窗 → 列为未完成项。
  // 这里对"全部提醒"统一应用同一组开关（M1 全局策略），后续可按单个提醒细化。

  // 读取当前聚合状态（随 reminders 变化自动刷新）
  const workWindow = $derived(reminders.some((r) => r.workWindow.enabled));
  const idlePause = $derived(reminders.some((r) => r.gates.idlePause));
  const meetingPause = $derived(reminders.some((r) => r.gates.meetingPause));
  const whitelist = $derived(reminders.some((r) => r.gates.appWhitelist.length > 0));
  const preWarn = $derived(reminders.some((r) => r.gates.preWarn));

  function applyAll(mutate: (r: Reminder) => void) {
    for (const r of reminders) {
      mutate(r);
      getEngine().update(r);
    }
  }

  function toggleWorkWindow() {
    const target = !workWindow;
    applyAll((r) => (r.workWindow.enabled = target));
  }
  function toggleIdlePause() {
    const target = !idlePause;
    applyAll((r) => (r.gates.idlePause = target));
  }
  function toggleMeetingPause() {
    const target = !meetingPause;
    applyAll((r) => (r.gates.meetingPause = target));
  }
  function togglePreWarn() {
    const target = !preWarn;
    applyAll((r) => (r.gates.preWarn = target));
  }
  function toggleWhitelist() {
    const target = !whitelist;
    applyAll((r) => {
      // 开启时给一份常见演示/娱乐白名单；关闭则清空
      r.gates.appWhitelist = target ? ['powerpnt', 'keynote', 'wps', 'obsidian'] : [];
    });
  }
</script>

<div class="greet">
  <div><div class="sub">偏好设置</div><h1>设置</h1></div>
</div>

<div class="sectiontitle">提醒时段</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">工作时间窗</div><div class="d">仅 09:00 – 18:00 提醒</div></div>
    <div class="switch {workWindow ? 'on' : ''}" onclick={toggleWorkWindow}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">午休勿扰</div><div class="d">12:00 – 13:00 不提醒</div></div>
    <div class="switch off" title="需要引擎支持多时间段（未完成）"><i></i></div>
  </div>
</div>

<div class="sectiontitle">智能免打扰（P1 核心 · 已接通引擎）</div>
<div class="card">
  <div class="setrow">
    <div><div class="t">空闲自动暂停</div><div class="d">离开座位超 5 分钟暂停</div></div>
    <div class="switch {idlePause ? 'on' : ''}" onclick={toggleIdlePause}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">投屏/会议自动暂停</div><div class="d">演示时不打扰</div></div>
    <div class="switch {meetingPause ? 'on' : ''}" onclick={toggleMeetingPause}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">应用白名单</div><div class="d">前台运行时不弹提醒</div></div>
    <div class="switch {whitelist ? 'on' : ''}" onclick={toggleWhitelist}><i></i></div>
  </div>
  <div class="setrow">
    <div><div class="t">休息前预告</div><div class="d">提前 10 秒预留保存</div></div>
    <div class="switch {preWarn ? 'on' : ''}" onclick={togglePreWarn}><i></i></div>
  </div>
</div>

<div class="sectiontitle">外观与同步</div>
<div class="card">
  <div class="setrow"><div class="t">主题</div><div class="muted">跟随系统</div></div>
  <div class="setrow"><div class="t">云同步（高级版）</div><div class="muted">未开启</div></div>
  <div class="setrow"><div class="t">关于节奏</div><div class="muted">v0.1.0</div></div>
</div>

<div class="muted" style="font-size:12px;padding:0 4px;">已配置提醒：{reminders.length} 个 · 开关即时生效并写回引擎</div>
