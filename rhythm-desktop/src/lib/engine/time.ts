// rhythm-core / time.ts
// 纯时间工具：HH:MM 解析、工作窗判断、找下一个工作窗边界。无平台依赖。

/** "HH:MM" -> 当天分钟数（0..1439） */
export function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/** epoch ms -> "HH:MM"（本地，基于传入的 Date，保持纯函数：调用方给 Date） */
export function minutesToClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 判断某个"HH:MM"是否落在工作窗 [start,end) 内。
 * 跨午夜（如 22:00-06:00）也支持。
 */
export function withinWorkWindow(clock: string, w: { start: string; end: string }): boolean {
  const cur = clockToMinutes(clock);
  const s = clockToMinutes(w.start);
  const e = clockToMinutes(w.end);
  if (s === e) return true; // 退化成全天
  if (s < e) return cur >= s && cur < e;
  // 跨午夜
  return cur >= s || cur < e;
}

/**
 * 从 now（epoch ms）往后找"下一个工作窗开始时刻"。
 * 用于：当前在非工作时段时，把下次触发推到明早工作窗起点。
 */
export function nextWorkWindowStart(
  now: number,
  w: { start: string; end: string; days?: number[] },
  getLocal: (ms: number) => { clock: string; weekday: number },
): number {
  const startMin = clockToMinutes(w.start);
  // 最多往后看 14 天
  for (let d = 0; d < 14; d++) {
    const t = now + d * 86400000;
    const { weekday } = getLocal(t);
    if (w.days && w.days.length > 0 && !w.days.includes(weekday)) continue;
    const dayStart = new Date(t);
    // 构造当天 start 的 epoch：用本地日期 + startMin
    const base = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, 0, 0, 0);
    const candidate = base.getTime() + startMin * 60000;
    if (candidate > now) return candidate;
  }
  return now + 60000;
}

/** 给定一组时间段，判断某"HH:MM + 星期"是否落在其中任意一个（启用且星期匹配）内 */
export function withinAnyWindow(
  windows: { enabled?: boolean; start: string; end: string; days?: number[] }[] | undefined,
  clock: string,
  weekday: number,
): boolean {
  if (!windows || windows.length === 0) return false;
  const cur = clockToMinutes(clock);
  for (const w of windows) {
    if (w.enabled === false) continue;
    if (w.days && w.days.length > 0 && !w.days.includes(weekday)) continue;
    const s = clockToMinutes(w.start);
    const e = clockToMinutes(w.end);
    if (s === e) continue;
    if (s < e) {
      if (cur >= s && cur < e) return true;
    } else if (cur >= s || cur < e) return true; // 跨午夜
  }
  return false;
}

/**
 * 给定一个候选触发时刻 base，返回"不落在任何勿扰时段内"的最早时刻（>= base）。
 * 用于 nextFireTime：若 base 落在午休等勿扰窗内，顺延到该窗结束之后。
 */
export function nextOutsideQuiet(
  base: number,
  windows: { enabled?: boolean; start: string; end: string; days?: number[] }[] | undefined,
  getLocal: (ms: number) => { clock: string; weekday: number },
): number {
  if (!windows || windows.length === 0) return base;
  let t = base;
  for (let guard = 0; guard < 30; guard++) {
    const loc = getLocal(t);
    const hit = windows.find((w) => {
      if (w.enabled === false) return false;
      if (w.days && w.days.length > 0 && !w.days.includes(loc.weekday)) return false;
      return withinWorkWindow(loc.clock, w);
    });
    if (!hit) return t;
    // 跳到该窗当天的结束时刻之后
    const dayBase = new Date(t);
    const base0 = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 0, 0, 0, 0);
    const endMin = clockToMinutes(hit.end);
    t = base0.getTime() + endMin * 60000 + 1000;
    if (t <= base) t = base + 86400000; // 安全兜底
  }
  return t;
}
