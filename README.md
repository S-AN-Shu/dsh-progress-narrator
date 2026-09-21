# dsh-progress-narrator

一个适用于 DeepSeek Harness（DSH）的 Host + Web Client 插件，用简短、安静的工作说明让长任务保持可理解。它不会显示深度思维链，也不会控制工具执行。

## 做什么

- 在本来就要发生的模型请求边界注入一次简短的播报规则；模型自己生成工作说明。
- 首次实际工作前要求先用一句话说明准备做什么；若模型直接开始工具调用，下一次边界只补一次提醒。
- 默认在距离上次播报 120 秒或连续 6 个已完成 assistant 步没有播报时提醒一次。
- 未回应时最多退避到 240 秒；审批、取消、停止和空请求不会消耗提醒预算。
- 默认不显示等待面板、不显示图标或卡片；正文中的工作说明使用 14px 普通字重。
- 在官方对话视图中保留工作说明，并提供基础历史思考/工具输出折叠。
- 检测到 better-display Reader 后让 Reader 独占过程折叠，避免两个插件同时操作同一段 DOM。
- 设置页支持频率、步骤阈值、折叠、播报风格和自定义规则；配置通过 DSH settings 持久化并带 revision 冲突保护。

插件只观察公开会话事件和助手流，不创建额外模型请求、不执行工具、不伪造结果、不输出内部逐步推理。Host 状态路由使用 DSH Connection 的认证边界。

## 与 better-display 的关系

better-display 是另一个独立项目（上游仓库 [aa2246740/dsh-better-display](https://github.com/aa2246740/dsh-better-display)，以 npm 包 `dsh-better-display` 发布，MIT），不是本仓库的一部分，也不由本插件发布。它的 Reader 组件、Reader bundle 和视觉样式由该项目自行开发、发布和升级；本插件对它的适配是单向的，不复制 Reader 源码，也不改动 Reader 的实现。

兼容是自动的，用户不需要选择适配器：

- 只安装本插件：在官方对话视图中提供基础折叠与播报行展示。
- 同时安装并加载 better-display：本插件检测 Reader 挂载后写入的 DOM 标记（`[data-dsh-better-display]`、`[data-reader-flow]`、`[data-reader-turn]`），一旦发现就立即停止自己的折叠控制，让 Reader 独占过程折叠和播报行展示，避免两个插件同时操作同一段 DOM。
- 检测在运行时进行，不依赖安装顺序、配置开关或手动切换；用户不需要手动选择适配器，也不需要把 Reader 源码复制进本仓库。

Reader 的 UI 和折叠由 better-display 自己提供，本插件不重复实现同一套界面，因此不会重复挂载；better-display 也可以按自己的节奏升级，不必等本插件同步发版。两者之间的适配层，就是公开的进度行协议（本插件的 `lib/protocol.js`）加上这一组运行时标记。

需要 Reader 侧配合的改动属于 better-display 项目：应在上游仓库（或你的 fork）中完成，本仓库只保留检测逻辑和兼容说明。本插件作者对 Reader 的适配改动在自己的 fork（[`S-AN-Shu/dsh-better-display`](https://github.com/S-AN-Shu/dsh-better-display)）中维护，与本仓库相互独立、各自发布。

## 进度行协议

模型工作说明使用顶层独占行：

```text
📌 进度：我正在核对配置并验证下一步结果。
```

前缀只用于识别，客户端展示时不显示图标或前缀。代码围栏、列表、引用、缩进和常见 HTML 示例不会被识别。兼容顶层 ATX 标题、段落、中英文冒号和成对加粗形式。

## 安装

这是一个 DSH 外部插件源码仓库，当前不发布 npm 包。将仓库克隆到本机后，在 web profile 的 `package.json` 添加本地链接：

```json
{
  "@dsh-external/dsh-progress-narrator": "link:C:/path/to/dsh-progress-narrator"
}
```

再在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: progress-narrator
      name: '@dsh-external/dsh-progress-narrator'
      config: {}
```

重启 DSH 后，在设置页打开“工作说明”即可调整配置。不要把本仓库加入 profile bundles；它使用依赖和手工 insert 挂载。

## 开发

要求 Node.js 22+ 和一个可运行的 DSH profile。`lib/` 中的客户端和 Host 文件是运行产物；修改客户端时编辑 `src/client.js`，再生成 `lib/client.js`。

```powershell
npm install
npm test
npm run check
npm run build
npm pack --dry-run
```

`npm run build` 只生成客户端；Host 使用纯 ESM JavaScript，不需要额外构建链。提交前应同时检查测试、语法和 `npm pack --dry-run` 内容，不要提交 `node_modules`、备份文件或本机维护记录。

## 默认配置

| 配置 | 默认值 | 说明 |
| --- | ---: | --- |
| `enabled` | `true` | 启用 Host 和 Client |
| `firstNarration` | `true` | 首次实际工作前先说明一次 |
| `showStatusPanel` | `false` | 是否显示输入区等待状态面板 |
| `silentStepThreshold` | `6` | 无播报的已完成 assistant 步阈值 |
| `narrationIntervalMs` | `120000` | 无播报时间阈值 |
| `minNudgeIntervalMs` | `120000` | 已接纳提醒的最短间隔 |
| `maxNudgesPerTurn` | `0` | 每轮提醒上限；`0` 表示不设硬上限 |
| `autoFoldHistory` | `true` | 仅控制官方视图的基础折叠；Reader 会独立管理 |
| `triggerMode` | `either` | 按时间或步骤任一项触发 |
| `narrationStyle` | `first-person` | 第一人称、阶段式、猫娘或自定义 |

## 验证范围

当前版本在本机 DSH 环境中完成 Host/Client 接线、48 项插件单测、客户端语法检查、构建和浏览器隔离验收。Reader 的 144 项测试、动画回归和实际历史会话折叠验收属于 better-display 项目，不是本仓库测试套件的一部分。

## 许可

BSD-3-Clause，见 [LICENSE](LICENSE)。
