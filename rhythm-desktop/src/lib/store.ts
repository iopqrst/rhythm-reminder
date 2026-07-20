// src/lib/store.ts
// 引擎的持久化适配 + 单例。M1 预览用 LocalStore（localStorage，同步接口、webview 可用）；
// 生产环境 Tauri 改为 SQLite（见下方 SqlStore 脚手架，M2 接通 @tauri-apps/plugin-sql）。

import { RhythmEngine, MemStore, type ReminderStore, type Reminder, type ReminderState } from './engine/index';
import { createReminderFromTemplate, type ReminderKind } from './engine/index';

/** 本地时区 -> {clock, weekday}，与引擎内部本地计算一致 */
export const getLocal = (ms: number) => ({
  clock: new Date(ms).toTimeString().slice(0, 5),
  weekday: new Date(ms).getDay(),
});

/** M1 预览持久化：localStorage 实现同步 ReminderStore 接口 */
class LocalStore implements ReminderStore {
  private key = 'rhythm.reminders';
  private sKey = 'rhythm.states';
  private read<T>(k: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  private write(k: string, v: unknown) {
    localStorage.setItem(k, JSON.stringify(v));
  }
  loadAll(): Reminder[] {
    return this.read<Reminder[]>(this.key, []);
  }
  save(r: Reminder): void {
    const all = this.loadAll().filter((x) => x.id !== r.id);
    all.push(r);
    this.write(this.key, all);
  }
  remove(id: string): void {
    this.write(this.key, this.loadAll().filter((x) => x.id !== id));
  }
  loadState(id: string): ReminderState | undefined {
    return this.read<Record<string, ReminderState>>(this.sKey, {})[id];
  }
  saveState(id: string, s: ReminderState): void {
    const m = this.read<Record<string, ReminderState>>(this.sKey, {});
    m[id] = s;
    this.write(this.sKey, m);
  }
}

/*
// ===== 生产环境 SQLite 适配脚手架（M2 接通）=====
// 注意：@tauri-apps/plugin-sql 为异步 API，需在 RhythmEngine 外层做"写后异步落库"桥接，
// 或用异步版引擎门面。M1 先用 LocalStore 跑通闭环。
import Database from '@tauri-apps/plugin-sql';
async function makeSqlStore(): Promise<ReminderStore> {
  const db = await Database.load('sqlite:rhythm.db');
  await db.execute(`CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, data TEXT)`);
  return {
    async loadAll() {
      const rows = await db.select<{ data: string }[]>('SELECT data FROM reminders');
      return rows.map((r) => JSON.parse(r.data) as Reminder);
    },
    async save(r) { await db.execute('INSERT OR REPLACE INTO reminders VALUES (?,?)', [r.id, JSON.stringify(r)]); },
    async remove(id) { await db.execute('DELETE FROM reminders WHERE id = ?', [id]); },
  } as unknown as ReminderStore;
}
*/

export const engine = new RhythmEngine(new LocalStore(), getLocal);

/** 首次运行播种内置模板，让用户 30 秒看到效果 */
export function seedIfEmpty(): void {
  if (engine.list().length > 0) return;
  (['eye', 'water', 'stand'] as ReminderKind[]).forEach((k) => {
    engine.add(createReminderFromTemplate(k));
  });
}
