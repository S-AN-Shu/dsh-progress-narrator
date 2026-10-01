# dsh-progress-narrator

一个适用于 DeepSeek Harness（DSH）0.2 的 Host + Web Client 插件，用简短、安静的工作说明让长任务保持可理解。它不会显示深度思维链，也不会控制工具执行。

0.3.0 使用当前 DSH 的公开会话事件、动态配置引用和原生聊天插槽；兼容范围声明为 `>=0.2.0-rc.1 <0.3.0`，已验证的内核版本为 `0.2.0-rc.2`。插件旧版 0.2.2 的接线属于旧内核实现，不能用它的历史验收代替当前兼容验证。包名仍为 `dsh-progress-narrator`，bundle 条目仍为 `progress-narrator`。

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

better-display 是独立项目（上游 [aa2246740/dsh-better-display](https://github.com/aa2246740/dsh-better-display)，npm 包 `dsh-better-display`，MIT）。它的 Reader、样式和版本由上游维护。本仓库不发布 better-display，也不提供它的适配版安装包。

本插件在官方“对话”页提供基础折叠和播报行展示。检测到 Reader 的 DOM 标记（`[data-dsh-better-display]`、`[data-reader-flow]`、`[data-reader-turn]`）后，会停止自己的折叠控制，让 Reader 管理过程区域。这个自动检测只解决折叠控制权，不代表 Reader 已支持播报协议。

### 安装 better-display 后，播报被折叠或出现图钉怎么办？

1. 切回 DSH 的官方“对话”页。播报会使用普通字重、淡灰白色展示，并隐藏识别前缀；不需要修改 better-display。
2. 如果继续使用“阅读”页，未适配的 Reader 可能把中间播报当作过程内容折叠，并原样显示 `📌 进度：`。关闭 Reader 的自动折叠可以查看过程中的播报，但不能消除前缀。
3. 如需在 Reader 中始终保留安静的播报，需要在你自己的 Reader 源码副本中做展示层修改。下面是基于 better-display 0.3.4 的修改位置；其他版本需重新核对接口。修改前备份已安装包和 profile，完成构建与本地安装后再验证。上游更新可能覆盖本地改动。

Reader 侧修改应限于以下位置：

- 在 `src/client/narration.tsx` 解析可见 `assistant-step` 的顶层播报行，解析规则与本插件的 `lib/protocol.js` 一致。用户输入、代码、引用和列表中的示例不能当作播报。
- 在 `src/client/Reader.tsx` 的每个 `TurnGroup` 中，把播报行放在 `ChoreographedFlow` 外部，这样过程折叠后它仍可见。使用普通字重、主题次级文字色、透明背景，不添加图标或卡片。
- 在 `src/client/Blocks.tsx` 只对助手正文的渲染副本过滤已经展示的播报，避免重复和前缀泄露。保留图片、工具块与其余文字；不要修改原始会话记录。
- 构建该源码副本的客户端产物后，按 DSH 的本地 bundle 安装流程使用它。不要只改源码而继续加载旧的 `lib/client.js`；也不要同时挂载两个 Reader bundle。

验收时应检查：过程展开/折叠各显示一次播报、前缀不外露、最终正文和附件仍可见、用户及代码示例不被过滤、原始会话文件不变。这些改动属于 Reader 的本地维护，不需要修改 DSH 内核或压缩配置。本仓库不把这类第三方改动混入 npm 播报包。

## 进度行协议

模型工作说明使用顶层独占行：

```text
📌 进度：我正在核对配置并验证下一步结果。
```

前缀只用于识别，客户端展示时不显示图标或前缀。代码围栏、列表、引用、缩进和常见 HTML 示例不会被识别。兼容顶层 ATX 标题、段落、中英文冒号和成对加粗形式。

## 安装

本仓库既是外部插件的源码仓库，也是一个标准的 DSH bundle：根目录的 `cordis.patch.yml` 由 manifest 里的 `dsh.bundle.patch` 声明，所以 `dsh plugin add` 安装后它会作为一层 profile 层生效。可使用发布的精确版本、提供的 `.tgz` 文件，或本地源码目录；不要把不同版本同时挂载在同一 profile。

**按 bundle 安装（推荐）**

```powershell
git clone https://github.com/S-AN-Shu/dsh-progress-narrator
dsh plugin --profile web add "link:C:/path/to/dsh-progress-narrator"
```

若使用提供的 0.3.0 发布包：

```powershell
dsh plugin --profile web add "file:C:/path/to/dsh-progress-narrator-0.3.0.tgz"
```

`dsh plugin add` 转发给 pnpm 安装，然后按已安装状态对账 `dsh.profile.bundles`：声明了 `dsh.bundle` 的依赖会加入 profile `package.json` 的 bundles 列表，它自带的 `cordis.patch.yml` 随层生效。0.3.0 已发布到 npm，Web CLI 可使用 `dsh plugin --profile web add "dsh-progress-narrator@0.3.0"`。桌面应用请在“插件 → 添加插件”中输入 `dsh-progress-narrator@0.3.0`，由桌面插件管理器安装；上面的 Web CLI 命令不会安装到桌面应用。

**手工挂载（不使用 bundle 层）**

在 profile 的 `package.json` 里加本地链接依赖：

```json
{
  "dsh-progress-narrator": "link:C:/path/to/dsh-progress-narrator"
}
```

再在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: progress-narrator
      name: 'dsh-progress-narrator'
      config: {}
```

两种方式只选一种：同一个 `id` 同时出现在 bundle 层和 profile 的 `cordis.patch.yml` 里会被挂载两次，DSH 启动时报 `duplicate loader entry id`。

重启 DSH 后，在设置页打开“工作说明”即可调整配置。

## 开发

要求 Node.js 22+ 和一个可运行的 DSH 0.2 profile。测试中的 scoped Cordis / Schemastery 必须来自当前宿主依赖，不能用旧的非 scoped 包替代。`lib/` 中的客户端和 Host 文件是运行产物；修改客户端时编辑 `src/client.js`，再生成 `lib/client.js`。

```powershell
npm install
npm test
npm run check
npm run build
npm pack --dry-run
```

`npm run build` 只生成客户端；Host 使用纯 ESM JavaScript，不需要额外构建链。提交前应同时检查测试、语法和 `npm pack --dry-run` 内容——产物里必须包含根目录的 `cordis.patch.yml`，它是安装路径依赖的 bundle 层。不要提交 `node_modules`、备份文件或本机维护记录。

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

0.3.0 候选在 DSH `0.2.0-rc.2` 的实际依赖上通过 52 项插件测试，以及构建、语法和发布包检查。额外的 4 项隔离契约验证使用当前 Cordis、Session v4、SettingsForms、SlotCore 和官方聊天图投影，覆盖请求接纳、配置 revision 冲突、动态引用更新、原生折叠后的工作说明保留及卸载清理。设置持久化适配器和 React 渲染在这些隔离验证中替换为测试夹具；它们不等同于真实浏览器交互、profile 文件写入或模型执行验收。

Reader 的测试与实际会话折叠验收属于 better-display 项目，不是本仓库测试套件的一部分。DOM 标记决定折叠所有权；第三方插件将来若更改标记，需要重新验证。

## 许可

BSD-3-Clause，见 [LICENSE](LICENSE)。
