# 技术设计文档（TDD）：节奏 Rhythm —— 灵活间隔提醒助手

> 版本：v1.0 ｜ 状态：可评审稿 ｜ 作者：架构组 ｜ 日期：2026-07-20
> 关联文档：PRD_节奏Rhythm_定时提醒产品.md（v1.0）

---

## 0. 设计总览与目标

本 TDD 服务于 PRD §1.4 的**平台决策**：**桌面端优先（Windows / macOS）**，后端通过"平台无关的间隔引擎核心 + 云同步"在 P1 阶段预留 iOS/Android 接入，避免重复造轮子。

设计四大原则：

1. **核心与平台解耦**：间隔引擎（触发器/状态机/调度/持久化抽象）必须用零平台依赖的语言与库编写，桌面与移动端共享同一份逻辑。
2. **系统能力隔离**：所有 OS 相关能力（通知、托盘、空闲检测、锁屏、全局快捷键、多显示器）收敛到"系统能力适配层"，向上暴露稳定接口，向下由平台实现。
3. **到点必达**：后台调度不走 JS 计时器，而由 Rust 守护线程 + 系统级定时器托管；通知走系统原生渠道，误差目标 `< 5s`。
4. **隐私默认本地优先**：习惯数据默认仅存本地；启用云同步后，敏感字段端到端加密，服务器不可读。

---

## 1. 技术栈选型

### 1.1 Tauri vs Electron 对比

| 维度 | Tauri 2.x | Electron 27+ | 对本产品的含义 |
|---|---|---|---|
| **运行时包体** | ~5–15 MB（依赖系统 WebView：Win→WebView2 / macOS→WKWebView） | ~80–160 MB（内嵌 Chromium + Node） | 桌面健康工具常驻后台，小包体显著降低用户安装门槛与更新成本。**Tauri 胜** |
| **内存占用** | 常驻 30–60 MB | 常驻 120–250 MB | PRD §7 要求常驻 `< 80MB`，Electron 仅 baseline 已超标。**Tauri 胜** |
| **主语言** | Rust（前端可 TS/任意） | JS/TS（主进程 Node） | Rust 更适合写零依赖、可复用的"间隔引擎核心"，且能交叉编译到 iOS/Android（见 §3.7）。**Tauri 胜** |
| **安全性** | 默认最小权限，能力白名单（capabilities），Rust 内存安全 | Node 主进程权限大，需手动约束 | 常驻 + 后台定时器 + 系统调用场景，内存安全与最小权限更重要。**Tauri 胜** |
| **空闲检测 API** | 需自写 Rust 命令：`GetLastInputInfo`(Win) / `CGEventSourceSecondsSinceLastEventType`(mac) | 同样需自写 Node 原生模块（N-API） | 两者都需原生代码；Rust FFI 比 Node N-API 构建链路更轻。**持平（Tauri 略优）** |
| **系统托盘** | 一等支持 `tauri::tray` + `@tauri-apps/plugin-positioner` | `Tray` 原生支持，生态成熟 | 两者均成熟。**持平** |
| **全局快捷键** | `@tauri-apps/plugin-global-shortcut`（基于 `tauri-hotkey`） | `globalShortcut` 模块 | 两者均成熟。**持平** |
| **锁屏/会话切换 API** | 自写 Rust 命令（Win `WTSRegisterSessionNotification`；mac `NSWorkspace` 通知） | 自写 Node 原生模块 | 均需原生代码。**持平** |
| **多显示器** | 自写 Rust 命令（`EnumDisplayMonitors` / `NSScreen.screens`） | `screen` 模块成熟 | Electron 略成熟，但 Tauri 自写成本可控。**持平（Electron 略优）** |
| **投屏/会议检测** | 自写：检测前台窗口类/进程（PowerPoint/Teams/Zoom）+ 全屏状态枚举 | 同左 | 两者都需要启发式实现。**持平** |
| **生态/现成库** | 生态较新但增长快；部分能力需社区插件或自写 | npm 生态极大，库极多 | 复杂业务复用 npm 更省事。**Electron 胜** |
| **前端框架自由度** | 任意（React/Svelte/Vue，Tauri 无内置 UI） | 任意 | **持平** |
| **自动启动/单实例** | `@tauri-apps/plugin-autostart` + `tauri-plugin-single-instance` | 自写/`electron-squirrel-startup` | **持平** |
| **移动端复用路径** | Rust 核心可直接编译为 iOS/Android 原生库（via uniffi / FFI） | 需另起 Capacitor/React Native 重写逻辑 | 复用 PRD §1.4 的"移动端不重复造轮子"目标，**Tauri 唯一满足** |

**结论性对比：**

- 包体、内存、安全、移动端复用四项为**决定性差异**，且全部指向 Tauri。
- Electron 仅在"npm 库丰富度"和"多显示器生态成熟度"两项占优，这两项可通过自写少量 Rust 命令补足，不构成否决项。

### 1.2 明确推荐

> **推荐：Tauri 2.x + Rust 核心引擎 + TypeScript(Svelte/Vue) 前端。**

理由（对应 PRD 约束）：

1. **PRD §7 性能硬指标**（冷启动 < 1.5s、常驻内存 < 80MB）只有 Tauri 能达到；Electron 仅 Chromium baseline 即逼近上限。
2. **PRD §1.4 "平台无关的间隔引擎"**：Rust 核心可编译为 `cdylib`/`staticlib`，经 `uniffi` 生成 Swift/Kotlin 绑定，使 iOS/Android 在 M3 阶段**直接复用**同一份调度与状态机代码，满足"不重复造轮子"。
3. **安全与常驻**：健康提醒需常驻后台、读取空闲/锁屏等敏感系统状态，Rust 内存安全 + Tauri 能力白名单降低攻击面。
4. **桌面优先、移动后续**：Tauri 的 Rust 核心是唯一能让 M1 桌面与 M3 移动共享逻辑的路径，避免 Electron 路线下移动端被迫重写。

### 1.3 核心引擎语言决策

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 核心引擎用 Rust**（推荐） | 触发器/状态机/调度/持久化抽象写在 `rhythm-core` crate，零 `std::os` 依赖；桌面由 Tauri 调用，移动端经 uniffi 绑定 | ✅ 采用 |
| B. 核心引擎用 TS | 引擎写在 TS，桌面用 Tauri/Electron 均可，移动端需用 RN/Capacitor 重写或复用 JS | ❌ 移动端复用成本高于 A |

> 例外：若团队 Rust 产能不足，M1 可先用 TS 写引擎并严格保持"平台无关"纯函数结构，M3 前改写为 Rust。本报告按推荐方案 A 设计。

### 1.4 关键依赖清单（Tauri 侧）

| 能力 | 选型 |
|---|---|
| 前端框架 | SvelteKit / Vue3（轻量，贴合小包体） |
| 本地存储 | `@tauri-apps/plugin-sql`（SQLite，Rust `rusqlite` 后端） |
| 系统通知 | `@tauri-apps/plugin-notification`（mac 走 UNNotification；Win 走 WinRT Toast） |
| 托盘/菜单栏 | `tauri::tray` + `@tauri-apps/plugin-positioner` |
| 全局快捷键 | `@tauri-apps/plugin-global-shortcut` |
| 自动启动 | `@tauri-apps/plugin-autostart` |
| 单实例 | `tauri-plugin-single-instance` |
| 空闲/锁屏/多显/投屏 | **自写 Rust 命令**（`rhythm-platform` crate，见 §2） |

---

## 2. 分层 / 模块架构

### 2.1 分层图（依赖自上而下，核心不依赖平台）

```
┌──────────────────────────────────────────────────────────────────┐
│                      表现层 (Presentation)                         │
│  Svelte 窗口 UI  │ 托盘/菜单栏迷你态  │ 全屏休息弹窗  │ 设置页    │
└───────────────▲──────────────────────────────────────────────────┘
                │ 调用 (command/event)
┌───────────────┴──────────────────────────────────────────────────┐
│              系统能力适配层 (Platform Adapter)                      │
│  rhythm-platform (Rust FFI 命令)                                   │
│  ├─ 通知适配器    NotifyAdapter        (Win Toast / mac UN)        │
│  ├─ 托盘适配器    TrayAdapter          (菜单栏倒计时/一键暂停)       │
│  ├─ 空闲检测      IdleDetector         (GetLastInputInfo / CGEvent) │
│  ├─ 锁屏/会话     LockSessionWatcher   (WTS / NSWorkspace)          │
│  ├─ 全局快捷键    HotkeyAdapter        (plugin-global-shortcut)     │
│  ├─ 多显示器      DisplayManager       (EnumDisplayMonitors/屏幕)   │
│  └─ 投屏检测      PresentationDetector (前台窗口/全屏枚举启发式)     │
└───────────────▲──────────────────────────────────────────────────┘
                │ 调用 (纯函数 + trait)
┌───────────────┴──────────────────────────────────────────────────┐
│              间隔引擎核心 (rhythm-core, 平台无关)                    │
│  ├─ 触发器模型   Trigger = Period + WorkWindow + Gate[]            │
│  ├─ 状态机       Scheduler FSM (idle/running/break/paused/suppr)   │
│  ├─ 调度算法     next_trigger(now) / snooze / skip / pause         │
│  ├─ 数据结构     Reminder, Schedule, Gate, Event                  │
│  └─ 引擎门面     Engine trait (start/stop/tick/on_event)          │
└───────────────▲──────────────────────────────────────────────────┘
                │ 读写 (仓储抽象 trait)
┌───────────────┴──────────────────────────────────────────────────┐
│           数据持久化 & 云同步层 (Repository + Sync)                 │
│  ├─ 本地仓储   SQLite (rusqlite)  ←─ 离线优先，唯一事实源          │
│  ├─ 云客户端   rhythm-sync (REST/gRPC + 增量同步 + 冲突解决)        │
│  └─ 加密模块   crypto (XChaCha20-Poly1305, 字段级端到端加密)        │
└──────────────────────────────────────────────────────────────────┘
                │ HTTPS + JWT
┌──────────────────────────────────────────────────────────────────┐
│                        云端服务 (Backend)                          │
│  API 网关 │ 用户/设备/提醒/事件服务 │ 增量同步端点 │ 对象存储(动画) │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 各层职责与依赖方向

| 层 | 职责 | 关键约束 | 依赖方向 |
|---|---|---|---|
| **表现层** | 渲染窗口/托盘/全屏弹窗，捕获用户动作（完成/跳过/延后/暂停），下发命令 | 不直接碰 OS 原生 API；不写调度逻辑 | 仅依赖适配层与引擎门面（通过 Tauri command/event 桥接） |
| **系统能力适配层** | 把 OS 原生能力包装成稳定 trait/接口；向上暴露统一语义（如 `is_idle()`, `show_break()`），向下屏蔽 Win/mac 差异 | 可包含 `cfg(target_os)` 分支；**不持有业务状态** | 依赖引擎层（回调事件）+ 平台 SDK；**不被**引擎层依赖 |
| **间隔引擎核心** | 纯逻辑：计算下次触发、推进状态机、应用闸门、产出"待执行动作" | **零 `std::os`、零 Tauri、零网络依赖**；可单测、可跨平台编译 | 仅依赖"仓储抽象 trait"与标准库 |
| **数据持久化&云同步层** | 本地 SQLite 为唯一事实源；云同步做增量上行/下行、冲突合并、字段加密 | 离线优先；网络失败不阻塞引擎 | 被引擎层（经 trait）与适配层调用；依赖云端服务 |

> **核心不依赖平台** 的具体保证：`rhythm-core` 编译目标不含任何 `#[cfg(windows)]`/`#[cfg(target_os="macos")]`，CI 中以 `cargo build --target wasm32-unknown-unknown`（或纯 std）做"无平台依赖"断言，移动端经 `uniffi` 绑定复用。

### 2.3 模块依赖（精简）

```
rhythm-core  (no deps on platform/tauri/network)
   ▲
   │ (Engine trait, Repository trait)
   ├── rhythm-platform  (deps: tauri, windows-sys / core-graphics, objc)
   │      ▲
   │      │ (Tauri commands/events)
   │      └── desktop-app (Svelte UI + Tauri shell)
   │
   ├── rhythm-sync  (deps: reqwest/tonic, serde, crypto)
   │      ▲
   │      └── backend (separate service)
```

---

## 3. 间隔引擎设计

### 3.1 触发器模型

> PRD §4.2：「触发器 = 周期(n) + 时间段(工作窗) + 状态闸门(免打扰)」

```
Trigger = {
  period:          Duration,        // 工作/间隔时长 n（1..1440 min，PRD F2）
  break_duration:  Option<Duration>,// 双时长场景：番茄休息 5min（None=单时长）
  work_window:     WorkWindow,      // 仅该时段内触发（PRD F6）
  gates:           Vec<Gate>,       // 免打扰闸门集合（PRD F9）
}
```

**Gate（免打扰闸门，PRD F9 / §4.2）：**

| Gate 类型 | 触发条件 | 行为 |
|---|---|---|
| `IdleGate` | 距离上次输入 > `threshold`（默认 5min）视为离开 | 推迟触发，待活动恢复或窗口超时 |
| `PresentationGate` | 检测到投屏/会议前台（PowerPoint/Teams/Zoom 全屏） | 暂停该提醒直至退出 |
| `WhitelistGate` | 白名单 App（如 IDE/设计工具）前台 | 不弹全屏，仅轻提示或跳过 |
| `PreNoticeGate` | 触发前 `lead`（默认 10s） | 发"即将休息"预告，便于保存工作（PRD F10） |
| `StrictGate` | 严格模式开启 | 隐藏"跳过"，需完成通关动作（PRD F11） |

### 3.2 状态机

```
            ┌─────────────────────────────────────────────┐
            │                                             │
   new/disable│                                           ▼
┌──────────┐  start   ┌──────────┐  trigger fires   ┌──────────┐
│  IDLE    │─────────▶│ RUNNING  │─────────────────▶│  BREAK   │
│(无活跃/  │          │(倒计时到  │                  │(全屏休息  │
│ 暂停)    │◀─────────│ 下次触发) │  completed/skip  │ 态展示)   │
└──────────┘  pause   └──────────┘                  └──────────┘
   ▲   │                 │  ▲ pause                       │  │
   │   │                 ▼  │                             │  ▼
   │   │            ┌──────────┐  resume           resume│ ┌──────────┐
   │   └────────────│ PAUSED   │◀────────────────────────│ │ SUPPRESSED│
   │                │(全局暂停  │        gate active       │ │(闸门生效, │
   │                │ 暂停Until)│                          │ │ 如投屏)   │
   │                └──────────┘                          └──────────┘
   │                     ▲  resume                              │ gate clear
   └─────────────────────┘                                     ▼
                                                          back to RUNNING
```

| 状态 | 含义 | 进入条件 | 退出条件 |
|---|---|---|---|
| `IDLE` | 无启用提醒 / 全部禁用 | 初始化、全部停用 | 存在 enabled 提醒 |
| `RUNNING` | 正倒计时至下次触发 | 有启用提醒且在工作窗内 | 到点 / 暂停 / 闸门生效 |
| `BREAK` | 全屏休息态展示中 | 触发器 fire 且通过闸门 | 用户完成/跳过/延后 |
| `PAUSED` | 全局暂停（PRD F7） | 用户一键暂停 | `pauseUntil` 到达 / 用户恢复 |
| `SUPPRESSED` | 某闸门生效临时抑制 | `PresentationGate`/`WhitelistGate` 命中 | 闸门解除 |

### 3.3 核心数据结构（Rust 伪代码）

```rust
// ---- 领域实体 ----
struct Reminder {
    id: ReminderId,
    user_id: UserId,
    title: String,                 // 自定义文案（PRD F5）
    icon: String,                  // 图标 key
    template: TemplateKind,        // 护眼/喝水/.../自定义（PRD F1）
    color: Option<String>,
    sound: SoundSpec,              // 提示音（PRD F4）
    trigger: Trigger,
    enabled: bool,
    strict: bool,                  // 严格模式（PRD F11）
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,     // 云同步冲突依据（§5.3）
    device_origin: DeviceId,       // 创建设备，移动端预留（§5.4）
}

struct Schedule {                  // 运行时调度态，由引擎维护
    reminder_id: ReminderId,
    state: FsmState,               // 见 §3.2
    last_trigger_at: Option<DateTime<Utc>>,
    next_trigger_at: DateTime<Utc>,// 引擎计算（§3.4）
    snooze_until: Option<DateTime<Utc>>,
    current_cycle: u32,            // 连续天数/计数辅助
}

enum Gate {
    Idle { threshold_min: u32 },
    Presentation,
    Whitelist { apps: Vec<AppSpec> },
    PreNotice { lead_sec: u32 },
    Strict,
}

// ---- 事件（统计与同步的事实源，PRD F8/F12） ----
struct Event {
    id: EventId,
    reminder_id: ReminderId,
    kind: EventKind,               // Fired/FiredPreNotice/Completed/Skipped/Snoozed/Paused
    at: DateTime<Utc>,
    duration_sec: Option<u32>,     // 休息实际时长
    client_version: String,
}
```

### 3.4 调度算法

**核心函数 `compute_next_trigger(reminder, now)`：**

```
fn next_trigger(r: &Reminder, now: DateTime<Utc>) -> DateTime<Utc> {
    let base = r.last_trigger_at.unwrap_or(now);
    let mut cand = base + r.period;
    // 1) 工作窗约束：若落点不在工作窗内，推到下一工作窗起点
    cand = work_window::next_in_window(r.work_window, cand, now);
    // 2) 延后优先：若有 snooze_until 且更晚，取更晚
    if let Some(s) = r.snooze_until { cand = max(cand, s); }
    cand
}
```

**关键场景处理：**

| 场景 | 处理 |
|---|---|
| **暂停（F7）** | 全局 `pauseUntil` 注入；引擎 `tick` 时若 `now < pauseUntil` 则不 fire，并冻结所有 `next_trigger_at` 显示（UI 显示"已暂停"）。恢复后重新计算。 |
| **延后 5min（F3）** | 设 `snooze_until = now + 5min`，不记录 skip；`next_trigger_at` 取 `max(原下次, snooze_until)`。 |
| **跳过（F3）** | 记 `Event{Skipped}`，`last_trigger_at` 推进到当前周期起点，`next_trigger_at` 重算（进入下一周期），连续天数计数可能中断。 |
| **完成（F3）** | 记 `Event{Completed}`，推进 `last_trigger_at`，`next_trigger_at` 重算；连续天数 +1。 |
| **空闲闸门** | 到点时若 `IdleGate` 命中，`Postpone`：`next_trigger_at = now + poll_interval`（如 1min 轮询），不弹窗、不记 skip，直至用户活动恢复或工作窗超时。 |
| **投屏/白名单闸门** | 进入 `SUPPRESSED`；每 `poll_interval` 复查，闸门解除即回到 `RUNNING` 并立即评估触发。 |
| **工作窗外** | 不 fire；UI 显示"非工作时段"，`next_trigger_at` 指向次日窗起点。 |
| **预告（F10）** | `PreNoticeGate`：在 `next_trigger_at - lead` 发轻提示；主触发照常。 |

**调度驱动：** 引擎 `tick` 由 Rust 守护线程每 `1s` 唤醒，仅做"是否到达 `next_trigger_at`"判断；真正"到点必达"由系统级定时器（见 §4）兜底，避免 JS/线程休眠漂移。

### 3.5 本地持久化

- **引擎表**：`reminders`、`schedules`（运行时态可重建，建议也落库避免重启丢计数）、`events`、`gates`。
- **技术**：SQLite（`rusqlite`），由 `@tauri-apps/plugin-sql` 托管；文件位于用户数据目录（`%APPDATA%/rhythm` / `~/Library/Application Support/rhythm`）。
- **离线优先**：所有读写先落本地；云同步异步上行（§5）。本地为唯一事实源，网络失败零阻塞。
- **迁移**：`rusqlite::Migration` 或 `sqlx` 迁移脚本，版本化。

### 3.6 引擎可测试性

- `rhythm-core` 全部为纯函数 + 注入 `Clock` trait（测试用假时钟），可对"暂停/延后/跳过/空闲/工作窗"逐场景单测。
- 目标：调度单测覆盖 `compute_next_trigger` 全部边界（跨午夜、跨工作窗、闰秒忽略、snooze 叠加）。

### 3.7 移动端复用（为 M3 预留）

- `rhythm-core` 经 `uniffi` 生成 Swift/Kotlin 绑定；iOS/Android 应用直接调用同一 `Engine` 与 `compute_next_trigger`。
- 平台差异（iOS 后台限制、Android 前台服务）仅在各端"调度驱动"实现不同，引擎逻辑零改动（见 §7.1）。

---

## 4. 系统通知与后台保活

目标（PRD §7）：**后台保活 + 系统通知通道 + 到点必达，误差 < 5s**。

### 4.1 常驻与保活策略（Win / macOS 对照）

| 能力 | Windows | macOS | 说明 |
|---|---|---|---|
| **常驻进程** | Tauri 主进程常驻；`plugin-autostart` 写入注册表 `HKCU\...\Run` |  packaged app 常驻；Login Items（SMAppService）自启 | 托盘/菜单栏常驻即保活 |
| **系统通知渠道** | **WinRT Toast**（`winrt-notification` / Tauri notification 插件走 WinRT） | **UNNotification**（mac 原生通知中心） | 走系统渠道，不被"勿扰"外的机制吞掉 |
| **空闲检测** | `GetLastInputInfo()`（user32）→ `dwTime` 差 | `CGEventSourceSecondsSinceLastEventType()`（CoreGraphics/IOKit） | 自写 Rust 命令，1s 轮询 |
| **锁屏/会话切换** | `WTSRegisterSessionNotification` + `WM_WTSSESSION_CHANGE` | `NSWorkspace` `screensDidSleep`/`sessionDidResignActive` 通知 | 触发"强制休息"（PRD F3 锁屏态） |
| **全局快捷键** | `plugin-global-shortcut`（底层 `RegisterHotKey`） | 同插件（底层 `carbon`/`NSEvent`） | 一键暂停/完成 |
| **多显示器** | `EnumDisplayMonitors` 枚举；全屏弹窗可覆盖"主屏/所有屏" | `NSScreen.screens`；`NSPanel` 设 `styleMask` 覆盖所有空间 | PRD §6 多显示器场景 |
| **全屏休息弹窗** | `WS_EX_TOPMOST` + 置顶 + 可选 `LockWorkStation` | `NSPanel` 设 `collectionBehavior` 跨 Space + 置顶 | 强制休息态（F3/F11） |
| **投屏/会议检测** | 枚举前台窗口类/进程（PowerPoint/Teams/Zoom）；或 `DwmGetWindowAttribute` 判全屏 | `CGWindowListCopyWindowInfo` 查前台全屏 App | 启发式，见 §7.2 |

### 4.2 误差 < 5s 方案

1. **系统级定时器兜底**：Rust 守护线程使用 `std::thread::sleep` + `condvar`，并在启动时为"最近的下次触发"向 OS 注册一次性高精度计时（Win `CreateWaitableTimer`；mac `dispatch_source_set_timer`）。回调即 fire，避免轮询粒度误差。
2. **双保险**：1s 轮询 `tick` 负责闸门/空闲/预览；系统计时器负责"准时弹窗"。两者独立，任一失效仍有另一路。
3. **唤醒锁**：Windows 下避免 Modern Standby 节流（无关，运行时用户在前台）；macOS 下 `NSProcessInfo` 设 `beginActivityWithOptions` 防止 App Nap 把计时器挂起。
4. **校正**：每次 fire 后比对 `now` 与计划时间，偏差计入遥测；持续 > 5s 触发告警日志（排查系统节流/休眠）。

### 4.3 权限申请清单

| 平台 | 权限/授权 | 用途 | 申请时机 |
|---|---|---|---|
| Win | 自启动注册表写权限 | 开机常驻 | 首次启用"开机启动"时 |
| Win | 通知发送（Toast 需 App 注册 AUMID） | 系统通知 | 首次触发前引导用户开启通知 |
| Win | 前台/置顶窗口 | 全屏休息 | 弹窗时自动获得（无需授权） |
| mac | 通知权限（`UNUserNotificationCenter` `requestAuthorization`） | 系统通知 | 首次启动弹系统授权框 |
| mac | 辅助功能（Accessibility，可选） | 全局快捷键/投屏检测更稳 | 启用"投屏暂停"时引导 |
| mac | 登录项（Login Item） | 开机常驻 | 启用自启动时 |
| mac | 屏幕录制（仅当用 CGWindowList 做投屏检测） | 前台窗口枚举 | 启用投屏检测时引导（可降级为"仅前台 App 名"免录屏） |

> 隐私最小化：投屏检测默认只用"前台进程名 + 全屏标志"，**不读取屏幕内容**；如需像素级确认再申请录屏权限，且默认关闭。

---

## 5. 云端同步数据模型

### 5.1 实体关系

```
User 1──* Device 1──* Reminder 1──* Event
  │         │
  └─────────┴── (每个 Reminder/Event 带 device_origin + user_id)
```

### 5.2 表结构（PostgreSQL / 等价于 SQLite 本地）

```sql
-- 用户
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  email         TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan          TEXT NOT NULL DEFAULT 'free',   -- free / pro
  public_key    BYTEA,                           -- 端到端加密公钥(§5.5)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 设备（移动端预留，M3 多端）
CREATE TABLE devices (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  platform      TEXT NOT NULL,                   -- windows/macos/ios/android
  name          TEXT,
  push_token    TEXT,                            -- APNs/FCM，移动端用
  last_sync_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 提醒（配置，云端为镜像，本地为事实源）
CREATE TABLE reminders (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  device_origin UUID REFERENCES devices(id),     -- 创建设备
  title         TEXT NOT NULL,
  icon          TEXT,
  template      TEXT,                            -- eye/water/stand/.../custom
  color         TEXT,
  sound         JSONB,                           -- {name, volume}
  trigger       JSONB NOT NULL,                  -- {period, break_duration, work_window, gates}
  enabled       BOOLEAN NOT NULL DEFAULT true,
  strict        BOOLEAN NOT NULL DEFAULT false,
  encrypted_blob BYTEA,                          -- 敏感字段密文(§5.5)，可空
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

-- 事件（统计事实源，不可变追加）
CREATE TABLE events (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  device_id     UUID REFERENCES devices(id),
  reminder_id   UUID REFERENCES reminders(id),
  kind          TEXT NOT NULL,                   -- fired/completed/skipped/snoozed/paused
  at            TIMESTAMPTZ NOT NULL,
  duration_sec  INT,
  client_version TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_user_at ON events(user_id, at);
```

### 5.3 冲突解决策略

- **原则**：PRD §7「冲突以最后修改为准」→ **Last-Write-Wins (LWW)**，键为 `updated_at`（毫秒级 UTC，带设备偏移校正）。
- **范围**：`reminders` 行级 LWW；`events` **只追加不合并**（统计不可因同步丢数据，冲突时两侧都保留）。
- **机制**：
  1. 客户端上行带本地 `updated_at`；服务端比较，若 `incoming.updated_at > stored.updated_at` 则覆盖，否则忽略。
  2. 时钟漂移：用 NTP 对齐；`updated_at` 冲突（同毫秒）以 `device_origin` 字典序仲裁，确定性可复现。
  3. 增量同步：客户端记录 `last_sync_at`，仅上行/下行该时间戳之后的变更（拉：`?since=`，推：批量 upsert）。
- **删除**：软删除标记 `deleted_at`，避免 LWW 把删除覆盖成复活。

### 5.4 为 iOS/Android 预留的字段

| 字段 | 预留用途 |
|---|---|
| `devices.platform` / `push_token` | 移动端 APNs/FCM 推送触发（§7.1 后台限制应对） |
| `reminders.device_origin` | 多端溯源、冲突审计 |
| `events.device_id` | 区分各端完成来源，统计分端 |
| `reminders.trigger.gates` 预留 `MobileBackgroundGate` | iOS 后台 incapability 时的替代闸门 |
| `users.public_key` + `encrypted_blob` | 移动端同样走端到端加密 |

### 5.5 加密与隐私

- **传输**：全链路 HTTPS + JWT（`Authorization: Bearer`）。
- **存储**：服务端 `reminders`/`events` 落盘加密（KMS 托管密钥，静态加密）。
- **端到端（可选，高级版）**：敏感字段（标题/自定义文案可能含健康信息）用用户公钥（XChaCha20-Poly1305 / libsodium sealed box）加密为 `encrypted_blob`，**服务器仅存密文、不可读**；私钥仅存本地设备。
- **隐私承诺（PRD §7）**：本地优先；默认不联网；开通云同步时明示授权；不出售数据；提供导出/彻底删除（`GDPR` 风格 `DELETE /user` 级联清事件）。

### 5.6 同步触发与一致性

- **推送通知**：桌面端配置变更后，服务端可经 WebSocket 下发"增量变更"让其他在线设备即时拉取；移动端经 APNs/FCM 静默推送触发拉取。
- **离线**：本地优先，断网照常提醒；恢复后自动增量补传。
- **幂等**：所有 upsert 以 `id` 为主键，重复同步安全。

---

## 6. 里程碑映射

### M1（4 周）— 桌面 MVP（PRD F1–F8）

| 交付物 | 技术内容 | 关键风险 |
|---|---|---|
| `rhythm-core` 引擎骨架 | Trigger/Schedule/状态机/SQLite 仓储，纯函数 + 单测 | 引擎与平台边界划分不清导致移动端难复用（缓解：CI 无平台依赖断言） |
| 桌面壳（Tauri Win/mac） | 窗口 UI、托盘迷你态、全屏休息弹窗、全局快捷键 | Win/mac 两套托盘/弹窗差异耗时 |
| 模板冷启动 | F1 模板库 + 一键启用 | 模板数据建模冗余 |
| 基础统计 | `events` 本地聚合：今日完成/跳过/连续天数 | — |
| 系统通知 + 空闲/锁屏基础 | `NotifyAdapter`/`IdleDetector`/`LockSessionWatcher` | 锁屏检测在 mac 上权限/事件名踩坑 |
| 误差 < 5s 验证报告 | §4.2 双保险实测 | App Nap / 系统节流致漂移 |

### M2（4 周）— 免打扰 + 云同步（PRD F9–F13）

| 交付物 | 技术内容 | 关键风险 |
|---|---|---|
| 场景感知免打扰 | `PresentationDetector`/`WhitelistGate`/`IdleGate` 调参 | **投屏/会议检测误判**（§7.2），需 A/B 与可关开关 |
| 预告倒计时 | `PreNoticeGate` 提前 10s 轻提示 | 预告与正式触发时序竞争 |
| 严格模式 | `StrictGate` + 通关动作 | 体验 vs 完成率平衡（PRD §11） |
| 引导式动画 | Lottie/Gif 资源托管 + 播放组件 | 包体增大 |
| 云同步（移动端预留接口） | `rhythm-sync` + 后端 `reminders/events` API + LWW | 冲突合并边界（同毫秒、软删）需充分测试 |
| 加密模块 | `crypto` 字段级加密（高级版） | 密钥丢失即不可恢复，需备份引导 |

### M3（4 周）— 移动端接入 + 增长（PRD F15 + iOS/Android 接入）

| 交付物 | 技术内容 | 关键风险 |
|---|---|---|
| 引擎移动端绑定 | `rhythm-core` 经 uniffi 出 Swift/Kotlin | uniffi 绑定维护成本；Swift 异步桥接 |
| iOS/Android 客户端 | 复用引擎 + 原生通知/Widget | **iOS 后台触发限制**（§7.1）需 APNs 推送方案 |
| 游戏化 | 经验/连胜/徽章（基于 `events`） | 存储与计算上云，注意成本 |
| 桌面小组件/灵动岛等价物 | Win/mac 小组件常驻下次倒计时 | 各平台 widget 框架差异 |

### M4+（远期，PRD §10）

AI 排程（F16）、模板社区 UGC（F18）、企业版批量部署——架构上由 `rhythm-core` 可插拔 `SchedulerStrategy` + 后端模板服务支撑，无需改核心。

---

## 7. 开放技术风险

### 7.1 iOS 后台触发限制（PRD §11）

- **问题**：iOS 不允许第三方 App 在后台常驻运行定时器，无法像桌面那样"守护线程到点弹窗"。
- **方案（已定方向）**：
  1. **本地通知兜底**：用 `UNNotificationRequest` 的 `trigger` 预订未来若干次本地提醒（iOS 对本地通知调度友好），App 短暂前台时刷新预订；
  2. **APNs 静默推送**：服务端在计划触发时刻发静默推送唤醒 App Extension，由 Extension 重新预订并（在用户前台时）展示；
  3. **Widget/灵动岛常驻**：以 Widget 展示下次倒计时，降低对后台触发的依赖；
  4. **引擎复用**：上述三种"调度驱动"都调用同一 `rhythm-core::compute_next_trigger`，逻辑零改写。
- **待验证**：iOS 本地通知最大可预订数量与时域、静默推送送达率、被系统杀进程后的恢复策略——M3 前做 spike。

### 7.2 投屏 / 会议检测可行性（PRD §11）

- **Windows**：枚举前台窗口类/进程名（PowerPoint=`PPTFrameClass`、Teams/Zoom 进程）+ `DwmGetWindowAttribute` 判全屏，可行度高。
- **macOS**：`CGWindowListCopyWindowInfo` 取前台 App + 全屏标志；若需更准可请求"屏幕录制"权限做像素级确认（默认关、可降级）。
- **风险**：白名单/进程名随版本变动需维护表；误判（如看视频被当投屏）伤体验。缓解：默认仅"全屏 + 已知会议 App"才暂停，并提供"投屏检测"总开关与手动排除。

### 7.3 Tauri vs Electron 取舍的后续验证项

尽管 §1.2 已推荐 Tauri，仍保留以下验证清单，任意一项不达标则回退 Electron 评估：

| 验证项 | 验收标准 | 阶段 |
|---|---|---|
| 空闲检测精度 | Win/mac 误差 < 1s，1s 轮询稳定 | M1 |
| 锁屏/会话事件 | Win `WTS` / mac `NSWorkspace` 均能捕获 | M1 |
| 全屏弹窗覆盖多显 | 主屏/所有屏均可置顶且不被系统吞 | M1 |
| 包体/内存 | 安装包 < 30MB，常驻 < 80MB | M1 |
| 投屏检测 | 命中率 > 90%、误判 < 5%（内测） | M2 |
| 移动端 uniffi 绑定 | 引擎在 iOS 模拟器跑通调度单测 | M3 前 spike |
| 生态缺口成本 | 自写 Rust 命令总工时 < 等效 Electron 原生模块 | 持续 |

---

## 8. 附录：关键接口契约（速览）

**Engine trait（平台无关）**

```rust
trait Engine {
    fn start(&mut self);
    fn stop(&mut self);
    fn tick(&mut self, now: DateTime<Utc>) -> Vec<Action>; // 产出 fire/prenotice/suppress
    fn on_event(&mut self, e: UserEvent);                  // pause/snooze/skip/complete
    fn next_trigger(&self, reminder_id: &ReminderId) -> DateTime<Utc>;
}
```

**Platform Adapter 统一语义（供表现层调用）**

```rust
trait NotifyAdapter   { fn show_break(&self, r: &Reminder); fn preview(&self, lead: u32); }
trait IdleDetector    { fn idle_secs(&self) -> u64; }
trait LockWatcher     { fn on_lock(&self, cb: Box<dyn Fn(bool)>); }
trait DisplayManager  { fn screens(&self) -> Vec<Screen>; fn show_on(&self, s: &[ScreenId]); }
trait PresentationDetector { fn is_presenting(&self) -> bool; }
```

---

> 文档结束。本 TDD 与 PRD §1.4 平台决策一致：**桌面端优先（Tauri+Rust），引擎核心平台无关，M3 经 uniffi 复用至 iOS/Android，云同步 LWW 解决多端冲突。**
