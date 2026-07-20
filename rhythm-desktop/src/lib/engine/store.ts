// rhythm-core / store.ts
// 内存版 ReminderStore，供测试与无持久化场景使用。
// 真实桌面端用 Tauri 的 @tauri-apps/plugin-sql（SQLite）实现同一接口即可。

import type { Reminder, ReminderState } from './types';
import type { ReminderStore } from './engine';

export class MemStore implements ReminderStore {
  private map = new Map<string, Reminder>();
  private states = new Map<string, ReminderState>();

  loadAll(): Reminder[] {
    return [...this.map.values()];
  }
  save(r: Reminder): void {
    this.map.set(r.id, r);
  }
  remove(id: string): void {
    this.map.delete(id);
  }
  loadState(id: string): ReminderState | undefined {
    return this.states.get(id);
  }
  saveState(id: string, s: ReminderState): void {
    this.states.set(id, s);
  }
}
