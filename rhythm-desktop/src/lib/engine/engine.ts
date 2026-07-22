// rhythm-core / engine.ts
// 引擎门面：持有提醒与运行时状态，对外暴露增删改查与 tick 调度。
// 持久化通过注入的 ReminderStore 完成（本地 SQLite / 云同步均可插拔）。
// 仍然零平台依赖：时间本地化走注入的 getLocal，运行时上下文由系统适配层采集后传入。

import type { Reminder, ReminderState, RuntimeContext } from './types';
import type { GetLocal } from './scheduler';
import {
  createInitialState,
  nextFireTime,
  shouldFire,
  applyComplete,
  applySnooze,
  applySkip,
  applyPause,
  resume,
} from './scheduler';

/** 持久化抽象：引擎不关心底层是本地 SQLite 还是云端 */
export interface ReminderStore {
  loadAll(): Reminder[];
  save(r: Reminder): void;
  remove(id: string): void;
  loadState?(id: string): ReminderState | undefined;
  saveState?(id: string, s: ReminderState): void;
}

export interface TickResult {
  reminderId: string;
  fire: boolean;
  warn: boolean;
  reason?: string;
  nextFireAt: number;
}

export class RhythmEngine {
  private reminders = new Map<string, Reminder>();
  private states = new Map<string, ReminderState>();
  private getLocal: GetLocal;

  constructor(
    private store: ReminderStore,
    getLocal: GetLocal,
    private nowFn: () => number = () => Date.now(),
  ) {
    this.getLocal = getLocal;
    for (const r of store.loadAll()) {
      this.reminders.set(r.id, r);
      const st = store.loadState?.(r.id) ?? createInitialState(r, this.nowFn());
      this.states.set(r.id, st);
    }
  }

  list(): Reminder[] {
    return [...this.reminders.values()];
  }
  getState(id: string): ReminderState | undefined {
    return this.states.get(id);
  }

  add(r: Reminder): void {
    this.reminders.set(r.id, r);
    this.states.set(r.id, createInitialState(r, this.nowFn()));
    this.store.save(r);
  }
  update(r: Reminder): void {
    r.updatedAt = this.nowFn();
    this.reminders.set(r.id, r);
    this.store.save(r);
  }
  remove(id: string): void {
    this.reminders.delete(id);
    this.states.delete(id);
    this.store.remove(id);
  }
  setEnabled(id: string, enabled: boolean): void {
    const r = this.reminders.get(id);
    if (!r) return;
    r.enabled = enabled;
    r.updatedAt = this.nowFn();
    this.store.save(r);
  }

  /** 状态写回持久层（fire-and-forget），保证暂停/延后/完成跨会话不丢 */
  private persist(id: string): void {
    const s = this.states.get(id);
    if (s) this.store.saveState?.(id, s);
  }

  pause(id: string, untilMs: number): void {
    const s = this.states.get(id);
    if (s) {
      applyPause(s, untilMs, this.nowFn());
      this.persist(id);
    }
  }
  resumeReminder(id: string): void {
    const r = this.reminders.get(id);
    const s = this.states.get(id);
    if (r && s) {
      resume(r, s, this.nowFn());
      this.persist(id);
    }
  }
  snooze(id: string, minutes: number): void {
    const r = this.reminders.get(id);
    const s = this.states.get(id);
    // 严格模式禁止延后：UI 已隐藏按钮，此处兜底防止程序化绕行
    if (r && r.gates.strictMode) return;
    if (s) {
      applySnooze(s, minutes, this.nowFn());
      this.persist(id);
    }
  }
  skip(id: string): void {
    const r = this.reminders.get(id);
    const s = this.states.get(id);
    if (!r || !s) return;
    // 严格模式禁止跳过：UI 已隐藏按钮，此处兜底防止程序化绕行
    if (r.gates.strictMode) return;
    applySkip(r, s, this.nowFn());
    this.persist(id);
  }
  complete(id: string): void {
    const r = this.reminders.get(id);
    const s = this.states.get(id);
    if (r && s) {
      applyComplete(r, s, this.nowFn());
      this.persist(id);
    }
  }

  /**
   * 系统适配层每 ~1s 调用一次：返回每个提醒的"是否触发 / 是否预告 / 下次触发时间"。
   * 实际的系统通知、托盘、全屏弹窗由上层根据 TickResult 驱动。
   */
  tick(ctx: RuntimeContext): TickResult[] {
    const out: TickResult[] = [];
    for (const r of this.reminders.values()) {
      const s = this.states.get(r.id);
      if (!s) continue;
      const res = shouldFire(r, s, ctx, this.getLocal);
      const next = nextFireTime(r, s, ctx, this.getLocal);
      out.push({
        reminderId: r.id,
        fire: res.fire,
        warn: res.warn,
        reason: res.reason,
        nextFireAt: next,
      });
    }
    return out;
  }

  nextFireOf(id: string, ctx: RuntimeContext): number | undefined {
    const r = this.reminders.get(id);
    const s = this.states.get(id);
    if (!r || !s) return undefined;
    return nextFireTime(r, s, ctx, this.getLocal);
  }
}
