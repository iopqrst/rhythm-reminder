// store_contract.test.ts
// 验证「引擎 ↔ ReminderStore 持久化契约」：任何实现该接口的类（含生产 SqlStore）
// 都应让引擎的 add/complete/remove 正确落库。这是 SQLite 接入的契约基线。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RhythmEngine, type ReminderStore, type Reminder, type ReminderState } from './index';
import { createReminderFromTemplate } from './index';

class MemStore implements ReminderStore {
  map = new Map<string, Reminder>();
  states = new Map<string, ReminderState>();
  saved: string[] = [];
  removed: string[] = [];

  loadAll(): Reminder[] {
    return [...this.map.values()];
  }
  save(r: Reminder): void {
    this.map.set(r.id, r);
    this.saved.push(r.id);
  }
  remove(id: string): void {
    this.map.delete(id);
    this.removed.push(id);
  }
  loadState(id: string): ReminderState | undefined {
    return this.states.get(id);
  }
  saveState(id: string, s: ReminderState): void {
    this.states.set(id, s);
  }
}

test('engine persists add/complete/remove through injected store', () => {
  const store = new MemStore();
  const engine = new RhythmEngine(store, (ms) => ({ clock: '', weekday: 0 }));

  const r = createReminderFromTemplate('eye');
  engine.add(r);
  assert.equal(store.map.has(r.id), true, 'add 应调用 store.save');
  assert.equal(store.saved.includes(r.id), true);

  engine.complete(r.id); // 完成应写回运行时状态
  assert.ok(store.states.has(r.id), 'complete 应调用 store.saveState');

  engine.remove(r.id);
  assert.equal(store.removed.includes(r.id), true, 'remove 应调用 store.remove');
  assert.equal(engine.list().length, 0);
});

test('engine reloads from store on construction (cold start contract)', () => {
  // 第一个引擎写入
  const store = new MemStore();
  const a = new RhythmEngine(store, (ms) => ({ clock: '', weekday: 0 }));
  a.add(createReminderFromTemplate('water'));
  a.add(createReminderFromTemplate('stand'));

  // 第二个引擎从同一个 store 冷启动，应能看到已有数据
  const b = new RhythmEngine(store, (ms) => ({ clock: '', weekday: 0 }));
  assert.equal(b.list().length, 2, '冷启动应从 store 载入已有提醒');
});
