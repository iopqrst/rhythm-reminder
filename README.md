# 节奏 Rhythm

> 桌面端优先的「每隔 n 分钟提醒做任何事」间隔提醒应用。
> 护眼、喝水、起身、拉伸、服药、番茄专注……一个通用间隔引擎全部搞定。

- **通用间隔引擎**：不绑定单一健康场景，任何「周期性提醒」都能配置
- **场景感知免打扰**：空闲检测 / 会议·投屏自动暂停 / 应用白名单 / 工作时段窗，做"不打扰的守护"
- **桌面优先，预留移动端**：菜单栏/托盘常驻 + 全屏休息弹窗；iOS/Android 后期复用引擎核心 + 云同步接入

---

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2.x |
| 前端 | Svelte 5 + Vite + TypeScript |
| 间隔引擎 | 平台无关的纯 TypeScript（`rhythm-core`），零平台依赖 |
| 系统能力 | 空闲检测 / 前台应用 / 会议启发式（Rust `collect_context`） |
| 持久化 | 本地存储 → M2 接入 SQLite + 云同步 |

## 目录结构

```
.
├── PRD_节奏Rhythm_定时提醒产品.md   # 产品需求文档
├── TDD_节奏Rhythm_技术设计.md        # 技术设计文档
├── ux-mockup/                       # 桌面化 UX 高保真原型（单文件 HTML）
└── rhythm-desktop/                  # 桌面应用工程（Tauri + Svelte）
    ├── src/lib/engine/              # 平台无关间隔引擎（已 14/14 单测通过）
    ├── src/lib/platform/            # 系统能力适配层（上下文采集 + 通知）
    ├── src/lib/components/          # 7 个 UI 组件
    └── src-tauri/                   # Rust 桌面壳（托盘/通知/空闲检测…）
```

## 快速开始（Web 预览，无需 Rust）

```bash
cd rhythm-desktop
npm install
npm run dev        # 浏览器预览，含完整调度与交互
npm test           # 跑引擎单元测试（14/14）
npm run build      # 编译前端到 dist/
```

## 桌面原生运行（需 Rust 工具链）

```bash
# 1. 安装 Rust + Tauri 前置（Windows 需 WebView2，macOS 需 Xcode CLT）
# 2. 补 src-tauri/icons/* 图标
npm run tauri dev        # 启动桌面应用
npm run tauri build      # 打包（Windows .msi / macOS .dmg）
```

> 说明：本机无 Rust 时仅能跑 Web 预览版；原生桌面二进制需在对应 OS 上构建
> （Tauri 不支持跨平台编译：Windows 包在 Windows 打，macOS 包在 Mac 打）。

## 平台支持状态

| 能力 | Windows | macOS |
|---|---|---|
| 工程/引擎 | ✅ | ✅ |
| 前台应用采集 | ✅ Win32 API | ✅ NSWorkspace |
| 空闲/会议检测 | ✅ | ✅ |
| 真机联调 | ⏳ 待验证 | ⏳ 待验证 |

## 路线图

- **M1（当前）**：桌面端 MVP——菜单栏常驻 + 全屏休息弹窗 + 通用间隔引擎 + 系统信号采集
- **M2**：场景感知免打扰打磨 + 云同步（多端一致、跨设备）
- **M3**：iOS / Android 接入（复用 `rhythm-core` 引擎核心）

## License

待定（默认保留所有权利，商用时请先联系作者）。
