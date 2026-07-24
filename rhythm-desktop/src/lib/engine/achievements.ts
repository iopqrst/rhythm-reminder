// rhythm-core / achievements.ts
// 成就与连续打卡（streak）的纯计算逻辑。零平台依赖，便于单元测试。
//
// 设计要点：
// - 完成事件（CompletionEvent）由引擎在每次"完成提醒"时记录；
// - 本模块只做"给定完成日志 → 推导统计/徽章"的纯函数，不含任何持久化；
// - 连续打卡(streak)以"本地自然日"为单位：某天只要完成过 ≥1 次提醒即算"打卡成功"。

import type { ReminderKind } from './types';

/** 一次完成事件：谁、什么类型、何时完成（epoch ms） */
export interface CompletionEvent {
  reminderId: string;
  kind: ReminderKind;
  at: number;
}

/** 本地自然日的 key，格式 YYYY-MM-DD（按运行机时区） */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 按天聚合完成次数 */
export function dailyCounts(log: CompletionEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of log) {
    const k = dayKey(e.at);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * 当前连续打卡天数：
 * - 从今天往前数连续"有完成"的整天数；
 * - 若今天还没完成，则容错（grace）：不立即断签，按"昨天截止的整段连续"计，
 *   即今天空档仍显示真实连击（如 7/21、7/22 完成、今天未做 → 显示 2），
 *   待今天完成则续上、断签则归零；
 * - 今天和昨天都没完成 → 0（断签）。
 */
export function currentStreak(log: CompletionEvent[], now: number): number {
  if (log.length === 0) return 0;
  const days = dailyCounts(log);
  if (days.size === 0) return 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(dayKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1); // grace：今天没做，看昨天
    if (!days.has(dayKey(cursor.getTime()))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 历史最长连续天数 */
export function longestStreak(log: CompletionEvent[]): number {
  const days = [...dailyCounts(log).keys()].sort();
  if (days.length === 0) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime();
    const next = new Date(days[i]).getTime();
    const diffDays = Math.round((next - prev) / 86400000);
    cur = diffDays === 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}

export function totalCompletions(log: CompletionEvent[]): number {
  return log.length;
}

/** 累计"打过卡"的自然日数 */
export function activeDays(log: CompletionEvent[]): number {
  return dailyCounts(log).size;
}

export function todayCount(log: CompletionEvent[], now: number): number {
  return dailyCounts(log).get(dayKey(now)) ?? 0;
}

export function countByKind(log: CompletionEvent[], kind: ReminderKind): number {
  return log.filter((e) => e.kind === kind).length;
}

// ---- 徽章定义 ----

export type BadgeMetric = 'currentStreak' | 'longestStreak' | 'total' | 'activeDays' | 'kind';

export interface Badge {
  id: string;
  icon: string;
  title: string;
  desc: string;
  /** 进度度量维度 */
  metric: BadgeMetric;
  /** 达标阈值 */
  need: number;
  /** metric === 'kind' 时，统计的提醒类型 */
  kind?: ReminderKind;
}

export const BADGES: Badge[] = [
  { id: 'first', icon: '🌱', title: '初次守护', desc: '完成第一次提醒', metric: 'total', need: 1 },
  { id: 'streak3', icon: '🔥', title: '三日坚持', desc: '连续打卡 3 天', metric: 'currentStreak', need: 3 },
  { id: 'streak7', icon: '🌟', title: '一周坚持', desc: '连续打卡 7 天', metric: 'currentStreak', need: 7 },
  { id: 'streak30', icon: '🏆', title: '月度达人', desc: '连续打卡 30 天', metric: 'currentStreak', need: 30 },
  { id: 'total30', icon: '📅', title: '满月', desc: '累计完成 30 次', metric: 'total', need: 30 },
  { id: 'total100', icon: '⭐', title: '百日', desc: '累计完成 100 次', metric: 'total', need: 100 },
  { id: 'active14', icon: '🗓️', title: '习惯生根', desc: '累计打卡 14 天', metric: 'activeDays', need: 14 },
  { id: 'water10', icon: '💧', title: '补水达人', desc: '完成喝水提醒 10 次', metric: 'kind', need: 10, kind: 'water' },
  { id: 'pomodoro50', icon: '🍅', title: '番茄战士', desc: '完成番茄专注 50 次', metric: 'kind', need: 50, kind: 'pomodoro' },
];

export interface AchievementSummary {
  currentStreak: number;
  longestStreak: number;
  totalCompletions: number;
  activeDays: number;
  todayCount: number;
  /** 已解锁的徽章 */
  earned: Badge[];
  /** 尚未解锁、但有进度的徽章（按进度降序，最多 4 个） */
  next: { badge: Badge; have: number; need: number }[];
}

function metricValue(b: Badge, base: Omit<AchievementSummary, 'earned' | 'next'>, log: CompletionEvent[]): number {
  switch (b.metric) {
    case 'currentStreak':
      return base.currentStreak;
    case 'longestStreak':
      return base.longestStreak;
    case 'total':
      return base.totalCompletions;
    case 'activeDays':
      return base.activeDays;
    case 'kind':
      return countByKind(log, b.kind!);
  }
}

/** 由完成日志推导全部成就统计 */
export function computeAchievements(log: CompletionEvent[], now: number): AchievementSummary {
  const base: Omit<AchievementSummary, 'earned' | 'next'> = {
    currentStreak: currentStreak(log, now),
    longestStreak: longestStreak(log),
    totalCompletions: totalCompletions(log),
    activeDays: activeDays(log),
    todayCount: todayCount(log, now),
  };

  const earned: Badge[] = [];
  const pending: { badge: Badge; have: number; need: number }[] = [];
  for (const b of BADGES) {
    const have = metricValue(b, base, log);
    if (have >= b.need) earned.push(b);
    else pending.push({ badge: b, have, need: b.need });
  }
  // 进度降序，取前 4 个作为"下个目标"
  pending.sort((a, b) => b.have / b.need - a.have / a.need);
  return { ...base, earned, next: pending.slice(0, 4) };
}
