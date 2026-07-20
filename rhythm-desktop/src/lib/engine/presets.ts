// rhythm-core / presets.ts
// F1 提醒模板库：内置科学模板，新用户 30 秒建好第一个提醒。
// 所有模板保持"平台无关"，仅描述数据与默认值。

import type { Reminder, ReminderKind, GateConfig, WorkWindow } from './types';

function defaultGates(): GateConfig {
  return {
    idlePause: true,
    idleMinutes: 5,
    meetingPause: false,
    appWhitelist: [],
    preWarn: true,
    warnSeconds: 10,
    strictMode: false,
  };
}

function defaultWorkWindow(): WorkWindow {
  return { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
}

function base(kind: ReminderKind, label: string, message: string): Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    kind,
    label,
    message,
    intervalMin: 20,
    mode: 'single',
    workMin: 25,
    breakMin: 5,
    longEvery: 4,
    sound: 'bell',
    enabled: true,
    workWindow: defaultWorkWindow(),
    gates: defaultGates(),
  };
}

/** 按模板种类生成一个完整 Reminder（含新 id 与时间戳） */
export function createReminderFromTemplate(
  kind: ReminderKind,
  id: string = crypto.randomUUID(),
  now: number = Date.now(),
): Reminder {
  let t: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>;
  switch (kind) {
    case 'eye':
      t = { ...base('eye', '护眼 · 20-20-20', '看看远处，放松双眼 20 秒'), intervalMin: 20 };
      break;
    case 'water':
      t = { ...base('water', '喝水', '喝一杯温水 💧'), intervalMin: 60 };
      break;
    case 'stand':
      t = { ...base('stand', '起身活动', '站起来活动 2 分钟 🧍'), intervalMin: 45 };
      break;
    case 'stretch':
      t = { ...base('stretch', '拉伸', '做一组肩颈拉伸 🤸'), intervalMin: 90 };
      break;
    case 'medication':
      t = { ...base('medication', '服药', '按时服药 💊'), intervalMin: 480 };
      break;
    case 'pomodoro':
      t = {
        ...base('pomodoro', '番茄专注', '专注 25 分钟 🍅'),
        mode: 'pomodoro',
        workMin: 25,
        breakMin: 5,
        longEvery: 4,
      };
      break;
    case 'custom':
    default:
      t = { ...base('custom', '自定义提醒', '做一件小事 ✏️'), intervalMin: 30 };
      break;
  }
  return { ...t, id, createdAt: now, updatedAt: now };
}

/** 模板中文名映射（供 UI 展示） */
export const TEMPLATE_LABELS: Record<ReminderKind, string> = {
  eye: '护眼',
  water: '喝水',
  stand: '起身',
  stretch: '拉伸',
  medication: '服药',
  pomodoro: '番茄',
  custom: '自定义',
};
