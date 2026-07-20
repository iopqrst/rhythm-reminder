// rhythm-core / scheduler.ts
// 纯调度逻辑：根据 Reminder + ReminderState + 外部 RuntimeContext 计算"何时触发/是否该触发"。
// 不 import 任何 OS/浏览器 API；时间本地化通过注入 getLocal 实现，便于测试。

import type { Reminder, ReminderState, RuntimeContext, GateConfig } from './types';
import { withinWorkWindow, nextWorkWindowStart, clockToMinutes } from './time';

/** 由调度层注入：把 epoch ms 转成本地 {clock:"HH:MM", weekday:0-6} */
export type GetLocal = (ms: number) => { clock: string; weekday: number };

/** 工作段时长（毫秒）：pomodoro 用 workMin，single 用 intervalMin */
function workSegmentMs(r: Reminder): number {
  return (r.mode === 'pomodoro' ? r.workMin : r.intervalMin) * 60000;
}

function dayAllowed(r: Reminder, weekday: number): boolean {
  if (!r.workWindow.days || r.workWindow.days.length === 0) return true;
  return r.workWindow.days.includes(weekday);
}

/** 评估免打扰闸门，返回是否被拦截及原因 */
export function evaluateGates(r: Reminder, ctx: RuntimeContext): { blocked: boolean; reason?: string } {
  const g: GateConfig = r.gates;
  if (g.meetingPause && ctx.inMeeting) return { blocked: true, reason: 'meeting' };
  if (g.idlePause && ctx.isIdle && ctx.idleSeconds >= g.idleMinutes * 60)
    return { blocked: true, reason: 'idle' };
  if (g.appWhitelist.length > 0 && ctx.activeApp && g.appWhitelist.includes(ctx.activeApp))
    return { blocked: true, reason: 'whitelist' };
  return { blocked: false };
}

/**
 * 计算"下次触发时间"（epoch ms）。
 * 用于 UI 展示"距下次提醒"以及系统定时器排程。
 */
export function nextFireTime(
  r: Reminder,
  s: ReminderState,
  ctx: RuntimeContext,
  getLocal: GetLocal,
): number {
  const now = ctx.now;
  if (s.pausedUntil && s.pausedUntil > now) return s.pausedUntil; // 暂停中，恢复后再算
  let base: number;
  if (s.phase === 'breaking') {
    base = s.phaseEndsAt + workSegmentMs(r);
  } else {
    base = s.phaseEndsAt;
  }
  if (base <= now) base = now + workSegmentMs(r);

  if (r.workWindow.enabled) {
    const loc = getLocal(base);
    if (!withinWorkWindow(loc.clock, r.workWindow) || !dayAllowed(r, loc.weekday)) {
      base = nextWorkWindowStart(now, r.workWindow, getLocal);
    }
  }
  if (s.snoozedUntil && s.snoozedUntil > now) {
    base = Math.max(base, s.snoozedUntil);
  }
  return base;
}

/**
 * 每 tick 调用：判断当前是否应当弹出提醒。
 * 返回 fire=true 表示到点；warn=true 表示进入"休息前预告"窗口。
 */
export function shouldFire(
  r: Reminder,
  s: ReminderState,
  ctx: RuntimeContext,
  getLocal: GetLocal,
): { fire: boolean; warn: boolean; reason?: string } {
  if (!r.enabled) return { fire: false, warn: false, reason: 'disabled' };
  if (s.pausedUntil && s.pausedUntil > ctx.now) return { fire: false, warn: false, reason: 'paused' };
  if (s.phase !== 'working') return { fire: false, warn: false, reason: 'not-working-phase' };

  const gate = evaluateGates(r, ctx);
  if (gate.blocked) return { fire: false, warn: false, reason: gate.reason };

  if (r.workWindow.enabled) {
    const loc = getLocal(ctx.now);
    if (!withinWorkWindow(loc.clock, r.workWindow) || !dayAllowed(r, loc.weekday))
      return { fire: false, warn: false, reason: 'outside-work-window' };
  }

  if (ctx.now >= s.phaseEndsAt) return { fire: true };

  if (r.gates.preWarn && s.phaseEndsAt - ctx.now <= r.gates.warnSeconds * 1000) {
    return { fire: false, warn: true, reason: 'pre-warn' };
  }
  return { fire: false, warn: false };
}

/** 用户完成提醒：推进状态机（single 进入下一工作段；pomodoro 进入休息段） */
export function applyComplete(r: Reminder, s: ReminderState, now: number): void {
  s.lastTriggeredAt = now;
  s.snoozedUntil = undefined;
  if (r.mode === 'pomodoro') {
    s.pomodoroCount += 1;
    const isLong = s.pomodoroCount % r.longEvery === 0;
    const breakMs = (isLong ? r.breakMin * 3 : r.breakMin) * 60000;
    s.phase = 'breaking';
    s.phaseEndsAt = now + breakMs;
  } else {
    s.phase = 'working';
    s.phaseEndsAt = now + r.intervalMin * 60000;
  }
}

/** 延后：把这次触发推后 minutes 分钟 */
export function applySnooze(s: ReminderState, minutes: number, now: number): void {
  s.snoozedUntil = now + minutes * 60000;
  s.phaseEndsAt = s.snoozedUntil;
}

/** 跳过：不计入完成，直接进入下一工作段（严格模式下 UI 隐藏此操作） */
export function applySkip(r: Reminder, s: ReminderState, now: number): void {
  s.snoozedUntil = undefined;
  s.phaseEndsAt = now + workSegmentMs(r);
}

/** 暂停到 untilMs（全局暂停 / 会议暂停常用） */
export function applyPause(s: ReminderState, untilMs: number): void {
  s.pausedUntil = untilMs;
  s.phase = 'paused';
}

/** 恢复：清除暂停，回到 working 阶段 */
export function resume(s: ReminderState, now: number): void {
  s.pausedUntil = undefined;
  s.phase = 'working';
  // 若暂停期间原定触发已过期，顺延一个工作段
  if (s.phaseEndsAt <= now) s.phaseEndsAt = now + 60000;
}

/** 新建提醒时构造初始状态 */
export function createInitialState(r: Reminder, now: number): ReminderState {
  return {
    reminderId: r.id,
    phase: 'working',
    phaseEndsAt: now + workSegmentMs(r),
    pomodoroCount: 0,
  };
}
