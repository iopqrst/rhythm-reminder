// src/lib/platform/context.ts
// 系统能力适配层（platform seam）。
// 职责：把"真实 OS 信号"采集成引擎需要的 RuntimeContext 片段。
// 引擎核心永远不 import 这里；本层可 import Tauri/浏览器 API。
//
// 两个实现：
//   - TauriContextProvider：真机环境，invoke('collect_context') 拿 Rust 侧真实信号；
//   - WebContextProvider：纯 Web/浏览器降级，用页面活动近似空闲，保证 dev/build 可跑。
// App 层用 getContextProvider() 按环境自动选择，并把返回片段与 now/weekday/clock 合并。

import type { RuntimeContext } from '../engine/index';

/** OS 侧采集到的运行时片段（now/weekday/clock 由 App 层补齐） */
export type ContextSample = Pick<
  RuntimeContext,
  'isIdle' | 'idleSeconds' | 'activeApp' | 'inMeeting'
>;

export interface ContextProvider {
  /** 标识当前实现（用于 UI 显示与调试） */
  readonly kind: 'tauri' | 'web';
  /** 采集一次真实系统信号；失败时须返回安全默认值，绝不抛出 */
  collect(now: number): Promise<ContextSample>;
  /** 释放监听等资源 */
  dispose?(): void;
}

/** 运行环境是否在 Tauri webview 内 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const SAFE_DEFAULT: ContextSample = {
  isIdle: false,
  idleSeconds: 0,
  activeApp: undefined,
  inMeeting: false,
};

/**
 * Web 降级实现：无法拿到系统级空闲/前台应用，
 * 用页面可见性 + 最近一次用户交互近似"空闲"。
 * inMeeting 恒 false、activeApp 恒 undefined（Web 无从得知）。
 */
export class WebContextProvider implements ContextProvider {
  readonly kind = 'web' as const;
  private lastActivity = Date.now();
  private readonly idleThresholdSec: number;
  private bound = false;
  private readonly onActivity = () => {
    this.lastActivity = Date.now();
  };

  constructor(idleThresholdSec = 300) {
    this.idleThresholdSec = idleThresholdSec;
    if (typeof window !== 'undefined') {
      const evts = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
      for (const e of evts) window.addEventListener(e, this.onActivity, { passive: true });
      document.addEventListener('visibilitychange', this.onActivity);
      this.bound = true;
    }
  }

  async collect(now: number): Promise<ContextSample> {
    // 页面隐藏（切到别的标签/最小化）也视为一种"离开"信号
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const idleSeconds = hidden ? this.idleThresholdSec : Math.max(0, Math.round((now - this.lastActivity) / 1000));
    return {
      ...SAFE_DEFAULT,
      idleSeconds,
      isIdle: idleSeconds >= this.idleThresholdSec,
    };
  }

  dispose(): void {
    if (!this.bound || typeof window === 'undefined') return;
    const evts = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
    for (const e of evts) window.removeEventListener(e, this.onActivity);
    document.removeEventListener('visibilitychange', this.onActivity);
    this.bound = false;
  }
}

/** Rust collect_context 命令的返回结构（snake_case，与 main.rs ContextDto 对齐） */
interface RustContextDto {
  idle_seconds: number;
  active_app?: string | null;
  in_meeting: boolean;
}

/**
 * Tauri 真机实现：invoke('collect_context') 拿系统真实信号。
 * 任意异常都降级为安全默认值，绝不让调度循环崩掉。
 */
export class TauriContextProvider implements ContextProvider {
  readonly kind = 'tauri' as const;
  private readonly idleThresholdSec: number;
  // 动态 import，避免纯 Web 构建时把 Tauri API 硬打进产物
  private invokeFn: ((cmd: string) => Promise<unknown>) | null = null;
  private loading: Promise<void> | null = null;

  constructor(idleThresholdSec = 300) {
    this.idleThresholdSec = idleThresholdSec;
  }

  private async ensureInvoke(): Promise<void> {
    if (this.invokeFn || this.loading) return this.loading ?? Promise.resolve();
    this.loading = import('@tauri-apps/api/core')
      .then((m) => {
        this.invokeFn = (cmd: string) => m.invoke(cmd);
      })
      .catch(() => {
        this.invokeFn = null;
      });
    return this.loading;
  }

  async collect(now: number): Promise<ContextSample> {
    try {
      await this.ensureInvoke();
      if (!this.invokeFn) return SAFE_DEFAULT;
      const dto = (await this.invokeFn('collect_context')) as RustContextDto;
      const idleSeconds = Math.max(0, Math.round(dto.idle_seconds ?? 0));
      return {
        idleSeconds,
        isIdle: idleSeconds >= this.idleThresholdSec,
        activeApp: dto.active_app ?? undefined,
        inMeeting: !!dto.in_meeting,
      };
    } catch {
      return SAFE_DEFAULT;
    }
  }
}

/** 按环境返回合适的 Provider：Tauri 优先，否则 Web 降级 */
export function getContextProvider(idleThresholdSec = 300): ContextProvider {
  return isTauri() ? new TauriContextProvider(idleThresholdSec) : new WebContextProvider(idleThresholdSec);
}
