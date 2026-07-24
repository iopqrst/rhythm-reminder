// rhythm-core / achievements.test.ts
// 成就与连续打卡的单元测试。运行：node --import tsx --test src/lib/engine/achievements.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type CompletionEvent,
  dayKey,
  dailyCounts,
  currentStreak,
  longestStreak,
  totalCompletions,
  activeDays,
  todayCount,
  countByKind,
  computeAchievements,
  BADGES,
} from './achievements.ts';

// 构造某个本地日期中午的时间戳（month 为 1-12，Date 构造器为 0-11）
function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h, 0, 0).getTime();
}
function ev(kind: CompletionEvent['kind'], day: number, h = 12): CompletionEvent {
  return { reminderId: 'r', kind, at: at(2026, 7, day, h) };
}

test('dayKey 生成本地 YYYY-MM-DD', () => {
  assert.equal(dayKey(at(2026, 7, 21, 9)), '2026-07-21');
  assert.equal(dayKey(at(2026, 12, 5, 23)), '2026-12-05');
});

test('dailyCounts 跨日/同日累加正确', () => {
  const log = [ev('eye', 21, 9), ev('eye', 21, 18), ev('water', 22, 10)];
  const m = dailyCounts(log);
  assert.equal(m.get('2026-07-21'), 2);
  assert.equal(m.get('2026-07-22'), 1);
  assert.equal(m.size, 2);
});

test('currentStreak：连续 3 天 = 3', () => {
  // 今天=7/23，连续 7/21,22,23
  const now = at(2026, 7, 23, 15);
  const log = [ev('eye', 21), ev('water', 22), ev('stand', 23)];
  assert.equal(currentStreak(log, now), 3);
});

test('currentStreak：今天未做但昨天做了 → 从容昨天截止的连续段计 = 2（grace）', () => {
  const now = at(2026, 7, 23, 15); // 今天 7/23 还没完成
  const log = [ev('eye', 21), ev('water', 22)]; // 7/21、7/22 连续 2 天
  // grace：今天空档不立即断签，按"昨天截止的整段连续"计，即 2 天
  assert.equal(currentStreak(log, now), 2);
});

test('currentStreak：今天和昨天都没做 → 0（断签）', () => {
  const now = at(2026, 7, 23, 15);
  const log = [ev('eye', 20), ev('water', 21)]; // 最近 7/21，断签
  assert.equal(currentStreak(log, now), 0);
});

test('currentStreak：中间断一天则只算最近一段', () => {
  const now = at(2026, 7, 25, 15);
  // 7/21, 7/22 完成；7/23 缺失；7/24, 7/25 完成 → 当前连续应为 2
  const log = [ev('eye', 21), ev('eye', 22), ev('eye', 24), ev('eye', 25)];
  assert.equal(currentStreak(log, now), 2);
});

test('longestStreak：挑出最长连续段', () => {
  const log = [
    ev('eye', 1), ev('eye', 2), ev('eye', 3), // 段1: 3 天
    ev('eye', 6), ev('eye', 7), // 段2: 2 天
    ev('eye', 10), // 段3: 1 天
  ];
  assert.equal(longestStreak(log), 3);
});

test('longestStreak：单天完成返回 1', () => {
  assert.equal(longestStreak([ev('eye', 15)]), 1);
});

test('todayCount / activeDays / totalCompletions', () => {
  const now = at(2026, 7, 23, 15);
  const log = [ev('eye', 23, 9), ev('eye', 23, 20), ev('water', 22), ev('stand', 21)];
  assert.equal(todayCount(log, now), 2);
  assert.equal(activeDays(log), 3);
  assert.equal(totalCompletions(log), 4);
});

test('countByKind 只统计指定类型', () => {
  const log = [ev('water', 1), ev('water', 2), ev('eye', 3), ev('pomodoro', 4)];
  assert.equal(countByKind(log, 'water'), 2);
  assert.equal(countByKind(log, 'pomodoro'), 1);
});

test('computeAchievements：连续 3 天点亮 first + streak3', () => {
  const now = at(2026, 7, 23, 15);
  const log = [ev('eye', 21), ev('water', 22), ev('stand', 23)];
  const s = computeAchievements(log, now);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.longestStreak, 3);
  const ids = s.earned.map((b) => b.id);
  assert.ok(ids.includes('first'));
  assert.ok(ids.includes('streak3'));
  assert.ok(!ids.includes('streak7'));
});

test('computeAchievements：喝水满 10 次点亮 water10', () => {
  const now = at(2026, 7, 23, 15);
  const log: CompletionEvent[] = [];
  for (let i = 0; i < 10; i++) log.push(ev('water', 23, 8 + i)); // 同日 10 次喝水
  const s = computeAchievements(log, now);
  const ids = s.earned.map((b) => b.id);
  assert.ok(ids.includes('water10'), 'water10 应解锁');
  assert.ok(ids.includes('first'));
});

test('computeAchievements：next 给出带进度的下个目标（最多 4 个）', () => {
  const now = at(2026, 7, 23, 15);
  // 只完成 1 次（today），currentStreak=1, total=1
  const log = [ev('eye', 23)];
  const s = computeAchievements(log, now);
  assert.equal(s.earned.length, 1); // 仅 first
  assert.ok(s.next.length > 0 && s.next.length <= 4);
  // next 应按进度降序：streak3(1/3) 应排在 streak30(0/30) 之前
  const pos3 = s.next.findIndex((n) => n.badge.id === 'streak3');
  const pos30 = s.next.findIndex((n) => n.badge.id === 'streak30');
  assert.ok(pos3 >= 0 && pos30 >= 0);
  assert.ok(pos3 < pos30, '进度更高的应排在更前面');
});

test('BADGES 定义完整且阈值合理', () => {
  assert.ok(BADGES.length >= 8);
  assert.ok(BADGES.every((b) => b.need >= 1));
  // 每个 kind 类徽章都必须指定 kind
  for (const b of BADGES) {
    if (b.metric === 'kind') assert.ok(b.kind, `徽章 ${b.id} 缺 kind`);
  }
});
