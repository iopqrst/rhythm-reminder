// src/lib/store.ts
// 引擎持久化适配层（生产版）。
//
// 设计要点（与 TDD 一致）：
// - RhythmEngine 的 ReminderStore 接口是同步的，平台无关引擎零改动；
// - 真机（Tauri）走 SQLite（@tauri-apps/plugin-sql），Web/降级走 localStorage；
// - SqlStore 内部用内存 Map 作同步真相源，落库为 fire-and-forget 异步（乐观写），
//   因此引擎的同步 save/remove 调用立即返回，后台再刷盘，不阻塞 1s 调度循环；
// - 因为引擎构造时会同步 store.loadAll()，SQLite 的异步加载必须在引擎构造前完成，
//   所以用 bootEngine() 异步初始化 store 后再 new RhythmEngine（boot 模式）。

import { RhythmEngine, type ReminderStore, type Reminder, type ReminderState } from './engine/index';
import { createReminderFromTemplate, type ReminderKind } from './engine/index';

/** 本地时区 -> {clock, weekday}，与引擎内部本地计算一致 */
export const getLocal = (ms: number) => ({
  clock: new Date(ms).toTimeString().slice(0, 5),
  weekday: new Date(ms).getDay(),
});

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 生产持久化实现：内存 Map 同步读写 + 异步落库。
 * 真机走 SQLite；非 Tauri 环境（Web 预览 / 测试）自动降级 localStorage。
 */
class SqlStore implements ReminderStore {
  private rm = new Map<string, Reminder>();
  private st = new Map<string, ReminderState>();
  private db: any = null;

  async init(): Promise<void> {
    if (isTauri) {
      try {
        const mod: any = await import('@tauri-apps/plugin-sql');
        const Database = mod.default ?? mod;
        this.db = await Database.load('sqlite:rhythm.db');
        await this.db.execute(
          'CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, data TEXT)',
        );
        await this.db.execute(
          'CREATE TABLE IF NOT EXISTS states (id TEXT PRIMARY KEY, data TEXT)',
        );
        const rows = (await this.db.select('SELECT data FROM reminders')) as { data: string }[];
        for (const row of rows) {
          const r = JSON.parse(row.data) as Reminder;
          this.rm.set(r.id, r);
        }
        const srows = (await this.db.select('SELECT id, data FROM states')) as {
          id: string;
          data: string;
        }[];
        for (const row of srows) {
          this.st.set(row.id, JSON.parse(row.data) as ReminderState);
        }
        return;
      } catch (e) {
        // SQLite 不可用（如权限/路径问题）时安全降级，不阻断应用
        console.warn('[rhythm] SQLite init failed, fallback to localStorage', e);
      }
    }
    this.loadLocal();
  }

  private loadLocal(): void {
    try {
      const raw = localStorage.getItem('rhythm.reminders');
      if (raw) for (const r of JSON.parse(raw) as Reminder[]) this.rm.set(r.id, r);
      const sraw = localStorage.getItem('rhythm.states');
      if (sraw) {
        const m = JSON.parse(sraw) as Record<string, ReminderState>;
        for (const k in m) this.st.set(k, m[k]);
      }
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }

  private persistLocal(): void {
    try {
      localStorage.setItem('rhythm.reminders', JSON.stringify([...this.rm.values()]));
      localStorage.setItem('rhythm.states', JSON.stringify(Object.fromEntries(this.st)));
    } catch {
      /* 忽略 */
    }
  }

  loadAll(): Reminder[] {
    return [...this.rm.values()];
  }
  save(r: Reminder): void {
    this.rm.set(r.id, r);
    if (this.db) {
      this.db
        .execute('INSERT OR REPLACE INTO reminders (id, data) VALUES (?, ?)', [
          r.id,
          JSON.stringify(r),
        ])
        .catch(() => {});
    } else {
      this.persistLocal();
    }
  }
  remove(id: string): void {
    this.rm.delete(id);
    this.st.delete(id);
    if (this.db) {
      this.db.execute('DELETE FROM reminders WHERE id = ?', [id]).catch(() => {});
    } else {
      this.persistLocal();
    }
  }
  loadState(id: string): ReminderState | undefined {
    return this.st.get(id);
  }
  saveState(id: string, s: ReminderState): void {
    this.st.set(id, s);
    if (this.db) {
      this.db
        .execute('INSERT OR REPLACE INTO states (id, data) VALUES (?, ?)', [
          id,
          JSON.stringify(s),
        ])
        .catch(() => {});
    }
  }
}

// ---- 引擎单例（boot 模式）----
let _engine: RhythmEngine | null = null;

/** 引擎未 boot 时抛错，强制调用方在 bootEngine 之后使用 */
export function getEngine(): RhythmEngine {
  if (!_engine) throw new Error('RhythmEngine not booted; call await bootEngine() first');
  return _engine;
}

/** 异步启动：初始化持久化 store（SQLite/localStorage），构造引擎，首次运行播种模板 */
export async function bootEngine(): Promise<void> {
  if (_engine) return;
  const store = new SqlStore();
  await store.init();
  _engine = new RhythmEngine(store, getLocal);
  // 首次运行播种内置模板，让用户 30 秒看到效果（幂等：仅在空库时）
  if (_engine.list().length === 0) {
    (['eye', 'water', 'stand'] as ReminderKind[]).forEach((k) =>
      _engine!.add(createReminderFromTemplate(k)),
    );
  }
}
