// src/lib/platform/notify.ts
// 跨环境系统通知：Tauri 用官方通知插件（到点必达），Web 降级到浏览器 Notification API。
// 与全屏 BreakOverlay 并发使用：即使用户在别的窗口，也能收到系统级提示。

import { isTauri } from './context';

let permissionAsked = false;

/** 发送一条系统通知；失败静默（通知不是关键路径，不应中断调度） */
export async function sendSystemNotification(title: string, body: string): Promise<void> {
  try {
    if (isTauri()) {
      const m = await import('@tauri-apps/plugin-notification');
      let granted = await m.isPermissionGranted();
      if (!granted && !permissionAsked) {
        permissionAsked = true;
        const res = await m.requestPermission();
        granted = res === 'granted';
      }
      if (granted) m.sendNotification({ title, body });
      return;
    }
    // Web 降级
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied' && !permissionAsked) {
      permissionAsked = true;
      const perm = await Notification.requestPermission();
      if (perm === 'granted') new Notification(title, { body });
    }
  } catch {
    // 通知失败不影响提醒主流程
  }
}
