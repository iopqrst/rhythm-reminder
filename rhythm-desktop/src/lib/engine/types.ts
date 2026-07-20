// rhythm-core / types.ts
// 平台无关的领域模型。禁止 import 任何 OS / 浏览器 / Tauri API。

/** 提醒类型（内置模板 + 自定义） */
export type ReminderKind =
  | 'eye'        // 护眼 20-20-20
  | 'water'      // 喝水
  | 'stand'      // 起身活动
  | 'stretch'    // 拉伸
  | 'medication' // 服药
  | 'pomodoro'   // 番茄专注
  | 'custom';    // 自定义

/** 提示音 */
export type SoundName = 'bell' | 'wave' | 'wood' | 'silent';

/**
 * 免打扰闸门配置。
 * 这些开关在引擎里只描述"规则"，是否触发由系统适配层采集的 RuntimeContext 决定。
 */
export interface GateConfig {
  /** 空闲自动暂停：设备空闲超过 idleMinutes 视为离开，暂停提醒 */
  idlePause: boolean;
  idleMinutes: number;
  /** 投屏/会议自动暂停：检测到演示/会议前台时暂停 */
  meetingPause: boolean;
  /** 应用白名单：白名单内 App 前台运行时不弹提醒 */
  appWhitelist: string[];
  /** 休息前预告：到点前 warnSeconds 秒给出预告（留给用户保存/暂停） */
  preWarn: boolean;
  warnSeconds: number;
  /** 严格模式：隐藏"跳过"，需通关动作才能跳过 */
  strictMode: boolean;
}

/** 工作时间窗（仅在此区间内提醒） */
export interface WorkWindow {
  enabled: boolean;
  /** "HH:MM" 24h，如 "09:00" */
  start: string;
  end: string;
  /** 0=周日 ... 6=周六；空/未提供表示每天 */
  days?: number[];
}

/** 提醒的运行模式 */
export type ReminderMode = 'single' | 'pomodoro';

/** 一个提醒的完整定义（持久化对象） */
export interface Reminder {
  id: string;
  kind: ReminderKind;
  label: string;
  message: string;
  /** 间隔（分钟）。single 模式作为周期；pomodoro 模式下忽略，用 workMin/breakMin */
  intervalMin: number;
  mode: ReminderMode;
  /** pomodoro 模式：专注时长（分钟） */
  workMin: number;
  /** pomodoro 模式：短休息时长（分钟） */
  breakMin: number;
  /** pomodoro 模式：长休息前需完成的短周期数 */
  longEvery: number;
  sound: SoundName;
  enabled: boolean;
  workWindow: WorkWindow;
  gates: GateConfig;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms（云同步冲突解决依据）
}

/** 运行时阶段 */
export type Phase = 'working' | 'breaking' | 'paused';

/**
 * 运行时状态（不持久化，或仅持久化少量字段用于跨会话恢复）。
 * 引擎的所有调度计算都基于这个状态 + 外部 RuntimeContext。
 */
export interface ReminderState {
  reminderId: string;
  phase: Phase;
  /** 当前阶段结束时间（epoch ms）。working 阶段结束即触发提醒；breaking 阶段结束回到 working */
  phaseEndsAt: number;
  /** 用户手动全局暂停的截止时间；undefined 表示未暂停 */
  pausedUntil?: number;
  /** 单次延后的截止时间（仅影响下一次）；undefined 表示无延后 */
  snoozedUntil?: number;
  /** pomodoro：已完成短周期计数 */
  pomodoroCount: number;
  lastTriggeredAt?: number;
}

/**
 * 系统适配层在每个 tick 喂给引擎的运行时上下文。
 * 引擎只读这个对象，绝不直接调用 OS API —— 保证平台无关。
 */
export interface RuntimeContext {
  now: number;            // 当前 epoch ms
  isIdle: boolean;        // 设备空闲（由空闲检测 API 得出）
  idleSeconds: number;    // 已空闲秒数
  activeApp?: string;     // 当前前台应用标识（用于白名单）
  inMeeting: boolean;     // 检测到投屏/会议
  /** 星期几 0-6（与 WorkWindow.days 对齐） */
  weekday: number;
  /** 当前 "HH:MM" */
  clock: string;
}
