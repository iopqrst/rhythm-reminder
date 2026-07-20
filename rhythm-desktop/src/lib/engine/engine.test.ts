// rhythm-core / engine.test.ts
// 纯函数 + 引擎门面的单元测试。运行：node --import tsx --test src/lib/engine/engine.test.ts
// getLocal 用本地时区，与引擎内部 nextWorkWindowStart 的本地 Date 构造保持一致，保证确定性。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RhythmEngine,
  MemStore,
  createReminderFromTemplate,
  createInitialState,
  shouldFire,
  nextFireTime,
  applyComplete,
  applySnooze,
  applySkip,
  applyPause,
  resume,
  type Reminder,
  type ReminderState,
  type RuntimeContext,
  type GetLocal,
} from './index.ts';

const getLocal: GetLocal = (ms) => ({
  clock: new Date(ms).toTimeString().slice(0, 5),
  weekday: new Date(ms).getDay(),
});

function noGateReminder(kind: Reminder['kind'] = 'eye'): Reminder {
  const r = createReminderFromTemplate(kind, 'r1', 1_000_000);
  r.workWindow.enabled = false;
  r.gates.idlePause = false;
  r.gates.meetingPause = false;
  r.gates.preWarn = false;
  r.gates.appWhitelist = [];
  return r;
}

function ctxAt(now: number, over: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    now,
    isIdle: false,
    idleSeconds: 0,
    activeApp: undefined,
    inMeeting: false,
    weekday: new Date(now).getDay(),
    clock: new Date(now).toTimeString().slice(0, 5),
    ...over,
  };
}

test('模板：护眼默认 20 分钟，番茄为 pomodoro 模式', () => {
  const eye = createReminderFromTemplate('eye', 'e', 0);
  assert.equal(eye.intervalMin, 20);
  assert.equal(eye.mode, 'single');
  const pomo = createReminderFromTemplate('pomodoro', 'p', 0);
  assert.equal(pomo.mode, 'pomodoro');
  assert.equal(pomo.workMin, 25);
  assert.equal(pomo.breakMin, 5);
});

test('初始状态：phaseEndsAt = now + 间隔', () => {
  const r = noGateReminder('eye'); // interval 20
  const s = createInitialState(r, 1_000_000);
  assert.equal(s.phase, 'working');
  assert.equal(s.phaseEndsAt, 1_000_000 + 20 * 60000);
});

test('到点触发：now >= phaseEndsAt 且未被拦截 → fire', () => {
  const r = noGateReminder('eye');
  const s = createInitialState(r, 1_000_000);
  s.phaseEndsAt = 1_000_000; // 已到点
  const res = shouldFire(r, s, ctxAt(1_000_000), getLocal);
  assert.equal(res.fire, true);
});

test('闸门：空闲拦截', () => {
  const r = noGateReminder('eye');
  r.gates.idlePause = true;
  r.gates.idleMinutes = 5;
  const s = createInitialState(r, 1_000_000);
  s.phaseEndsAt = 1_000_000;
  const res = shouldFire(r, s, ctxAt(1_000_000, { isIdle: true, idleSeconds: 600 }), getLocal);
  assert.equal(res.fire, false);
  assert.equal(res.reason, 'idle');
});

test('闸门：会议拦截', () => {
  const r = noGateReminder('eye');
  r.gates.meetingPause = true;
  const s = createInitialState(r, 1_000_000);
  s.phaseEndsAt = 1_000_000;
  const res = shouldFire(r, s, ctxAt(1_000_000, { inMeeting: true }), getLocal);
  assert.equal(res.fire, false);
  assert.equal(res.reason, 'meeting');
});

test('闸门：白名单拦截', () => {
  const r = noGateReminder('eye');
  r.gates.appWhitelist = ['zoom'];
  const s = createInitialState(r, 1_000_000);
  s.phaseEndsAt = 1_000_000;
  const res = shouldFire(r, s, ctxAt(1_000_000, { activeApp: 'zoom' }), getLocal);
  assert.equal(res.fire, false);
  assert.equal(res.reason, 'whitelist');
});

test('工作窗：非工作时段不触发，并推迟到下一个工作窗起点', () => {
  const r = createReminderFromTemplate('eye', 'w', 1_000_000);
  r.workWindow.enabled = true;
  r.workWindow.start = '09:00';
  r.workWindow.end = '18:00';
  r.workWindow.days = [new Date(1_000_000).getDay()];
  r.gates.idlePause = false;
  r.gates.meetingPause = false;
  r.gates.preWarn = false;
  // now = 当天本地 03:00
  const base = new Date(1_000_000);
  base.setHours(3, 0, 0, 0);
  const now = base.getTime();
  const s = createInitialState(r, now);
  const res = shouldFire(r, s, ctxAt(now), getLocal);
  assert.equal(res.fire, false);
  assert.equal(res.reason, 'outside-work-window');

  const next = nextFireTime(r, s, ctxAt(now), getLocal);
  const expected = new Date(now);
  expected.setHours(9, 0, 0, 0);
  assert.equal(next, expected.getTime());
  assert.ok(next > now);
});

test('预告：进入 warnSeconds 窗口返回 warn', () => {
  const r = noGateReminder('eye');
  r.gates.preWarn = true;
  r.gates.warnSeconds = 10;
  const s = createInitialState(r, 1_000_000);
  s.phaseEndsAt = 1_000_000 + 5000; // 5s 后到点，落在 10s 预告窗内
  const res = shouldFire(r, s, ctxAt(1_000_000), getLocal);
  assert.equal(res.fire, false);
  assert.equal(res.warn, true);
  assert.equal(res.reason, 'pre-warn');
});

test('完成（single）：进入下一工作段', () => {
  const r = noGateReminder('eye'); // 20min
  const s = createInitialState(r, 1_000_000);
  applyComplete(r, s, 1_000_000);
  assert.equal(s.lastTriggeredAt, 1_000_000);
  assert.equal(s.phase, 'working');
  assert.equal(s.phaseEndsAt, 1_000_000 + 20 * 60000);
});

test('完成（pomodoro）：短休息 5min，第 4 次转长休息 15min', () => {
  const r = createReminderFromTemplate('pomodoro', 'p', 0);
  r.workWindow.enabled = false;
  const s = createInitialState(r, 1_000_000);
  applyComplete(r, s, 1_000_000); // count=1, 短休
  assert.equal(s.phase, 'breaking');
  assert.equal(s.phaseEndsAt, 1_000_000 + 5 * 60000);
  s.pomodoroCount = 3;
  applyComplete(r, s, 2_000_000); // count=4 -> 长休
  assert.equal(s.phaseEndsAt, 2_000_000 + 15 * 60000);
});

test('延后：推送 phaseEndsAt 与 snoozedUntil', () => {
  const r = noGateReminder('eye');
  const s = createInitialState(r, 1_000_000);
  applySnooze(s, 5, 1_000_000);
  assert.equal(s.phaseEndsAt, 1_000_000 + 5 * 60000);
  assert.equal(s.snoozedUntil, 1_000_000 + 5 * 60000);
});

test('跳过：不计入完成，仅重排', () => {
  const r = noGateReminder('eye'); // 20min
  const s = createInitialState(r, 1_000_000);
  s.lastTriggeredAt = 999;
  applySkip(r, s, 1_000_000);
  assert.equal(s.phaseEndsAt, 1_000_000 + 20 * 60000);
  assert.equal(s.lastTriggeredAt, 999); // 未变
  assert.equal(s.snoozedUntil, undefined);
});

test('暂停/恢复', () => {
  const r = noGateReminder('eye');
  const s = createInitialState(r, 1_000_000);
  s.phaseEndsAt = 1_000_000;
  applyPause(s, 1_000_000 + 10 * 60000);
  assert.equal(s.phase, 'paused');
  let res = shouldFire(r, s, ctxAt(1_000_000), getLocal);
  assert.equal(res.fire, false);
  assert.equal(res.reason, 'paused');
  resume(s, 1_000_000);
  assert.equal(s.pausedUntil, undefined);
  assert.equal(s.phase, 'working');
});

test('引擎门面：tick 返回每个提醒的触发判定', () => {
  const store = new MemStore();
  const engine = new RhythmEngine(store, getLocal, () => 1_000_000);
  const r = noGateReminder('eye');
  r.id = 'tick1';
  r.workWindow.enabled = false;
  engine.add(r);
  const s = engine.getState('tick1')!;
  s.phaseEndsAt = 1_000_000; // 立即到点
  const results = engine.tick(ctxAt(1_000_000));
  assert.equal(results.length, 1);
  assert.equal(results[0].fire, true);
  assert.ok(results[0].nextFireAt > 1_000_000);
});
