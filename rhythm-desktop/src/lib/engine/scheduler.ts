// rhythm-core / scheduler.ts
// 纯调度逻辑：根据 Reminder + ReminderState + 外部 RuntimeContext 计算"何时触发/是否该触发"。
// 不 import 任何 OS/浏览器 API；时间本地化通过注入 getLocal 实现，便于测试。

import type { Reminder, ReminderState, RuntimeContext, GateConfig } from './types';
import { withinWorkWindow, nextWorkWindowStart, nextOutsideQuiet, withinAnyWindow } from './time';

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
  // 适配层已经把"空闲 >= 阈值"折算进 isIdle，这里只需直接采用（避免重复二次判阈）
  if (g.idlePause && ctx.isIdle) return { blocked: true, reason: 'idle' };
  if (g.appWhitelist.length > 0 && ctx.activeApp) {
    const app = ctx.activeApp.toLowerCase();
    // 白名单条目按"包含"模糊匹配（不区分大小写），命中即免打扰
    const hit = g.appWhitelist.some((w) => {
      const k = w.trim().toLowerCase();
      return k.length > 0 && app.includes(k);
    });
    if (hit) return { blocked: true, reason: 'whitelist' };
  }
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
  // 勿扰时段（如午休）：若 base 落在其中，顺延到该时段结束后
  base = nextOutsideQuiet(base, r.quietWindows, getLocal);
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

  // 勿扰时段（如午休）：落在其中不触发
  {
    const loc = getLocal(ctx.now);
    if (withinAnyWindow(r.quietWindows, loc.clock, loc.weekday))
      return { fire: false, warn: false, reason: 'quiet' };
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
    const isLong = r.longEvery > 0 && s.pomodoroCount % r.longEvery === 0;
    // 长休用独立的 longBreakMin；旧数据缺省回落为 breakMin*3，保证语义可配置且兼容
    const longMin = r.longBreakMin ?? r.breakMin * 3;
    const breakMs = (isLong ? longMin : r.breakMin) * 60000;
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

/** 暂停到 untilMs（全局暂停 / 会议暂停常用）。nowMs 为进入暂停的当前时刻。 */
export function applyPause(s: ReminderState, untilMs: number, nowMs: number): void {
  s.pausedUntil = untilMs;
  s.pausedAt = nowMs;
  s.phase = 'paused';
}

/** 恢复：清除暂停，回到 working 阶段。
 *  语义：暂停 = 冻结剩余时间。剩余时长 = phaseEndsAt - 暂停时刻；用其顺延，避免恢复后立刻误触发。
 *  注意：需要知道"暂停发生在何时"，故用 pausedUntil 之前必须先记录 pausedAt。
 */
export function resume(r: Reminder, s: ReminderState, now: number): void {
  const pausedAt = s.pausedAt ?? now;
  const remaining = Math.max(0, s.phaseEndsAt - pausedAt);
  s.pausedUntil = undefined;
  s.pausedAt = undefined;
  s.phase = 'working';
  // 用暂停前的剩余时长顺延；若已过期则给一个完整工作段，绝不"立刻触发"
  s.phaseEndsAt = now + (remaining > 0 ? remaining : workSegmentMs(r));
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
