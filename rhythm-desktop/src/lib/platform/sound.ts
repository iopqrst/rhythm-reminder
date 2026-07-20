// src/lib/platform/sound.ts
// 提示音：用 Web Audio API 实时合成（无需打包音频文件，WebView2 与浏览器均支持）。
// 任何异常都静默 —— 提示音不是关键路径，绝不应中断提醒主流程。

import type { SoundName } from '../engine/index';

let actx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!actx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    return actx;
  } catch {
    return null;
  }
}

/** 在 ac 时间轴上叠加一个带包络的振荡器 */
function tone(
  ac: AudioContext,
  freq: number,
  startOffset: number,
  dur: number,
  type: OscillatorType = 'sine',
  peak = 0.18,
): void {
  const t0 = ac.currentTime + startOffset;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** 各音色的合成配方 */
const RECIPES: Record<Exclude<SoundName, 'silent'>, (ac: AudioContext) => void> = {
  // 轻柔铃：两声清脆和音
  bell: (ac) => {
    tone(ac, 880, 0, 0.5, 'sine', 0.18);
    tone(ac, 1318.5, 0.12, 0.6, 'sine', 0.13);
  },
  // 海浪：三段递减正弦，模拟潮落
  wave: (ac) => {
    tone(ac, 520, 0, 0.7, 'sine', 0.12);
    tone(ac, 400, 0.35, 0.7, 'sine', 0.1);
    tone(ac, 300, 0.7, 0.9, 'sine', 0.08);
  },
  // 木鱼：两记短促高音
  wood: (ac) => {
    tone(ac, 1200, 0, 0.08, 'triangle', 0.2);
    tone(ac, 900, 0.12, 0.08, 'triangle', 0.15);
  },
};

/** 播放提示音；silent 或无音频环境直接跳过 */
export function playSound(name: SoundName): void {
  if (name === 'silent') return;
  const ac = getCtx();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') void ac.resume();
    (RECIPES[name] ?? RECIPES.bell)(ac);
  } catch {
    /* 忽略：提示音失败不影响提醒 */
  }
}
