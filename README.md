# dsh-progress-narrator

一个适用于 DeepSeek Harness（DSH）0.2 的 Host + Web Client 插件，用简短、安静的工作说明让长任务保持可理解。它不会显示深度思维链，也不会控制工具执行。

0.4.0 使用当前 DSH 的公开会话事件、动态配置引用和原生聊天插槽；兼容范围声明为 `>=0.2.0-rc.1 <0.3.0`，已验证的内核版本为 `0.2.0-rc.2`。插件旧版 0.2.2 的接线属于旧内核实现，不能用它的历史验收代替当前兼容验证。包名仍为 `dsh-progress-narrator`，bundle 条目仍为 `progress-narrator`。

## 做什么

- 在本来就要发生的模型请求边界注入一次简短的播报规则；模型自己生成工作说明。
- 每次工作播报通常用两三句话说明行动、发现及影响、下一步。普通正文也算已向用户说明，取消首次补报；纯工具先行仍可补报。
- 保留默认 120 秒／6 步提醒。普通正文提供最多 30 秒缓冲（取 30 秒、时间阈值、最短提醒间隔三者最小值）；显式播报重置阶段时间和步骤。提醒结合已有正文和工具结果补充新信息，完整说明后不重复。
- 未回应时最多退避到 240 秒；审批、取消、停止和空请求不会消耗提醒预算。
- 默认不显示等待面板、不显示图标或卡片；正文中的工作说明使用 14px 普通字重。
- 在官方对话原消息行内，按输出顺序保留普通正文与播报；过程普通段落字重600，播报仍是淡灰400。代码、表格、媒体、最终答复保留原样；思考及工具可折叠。
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

Reader 侧适配基于独立分支 [S-AN-Shu/dsh-better-display · reader-narration-0.3.4](https://github.com/S-AN-Shu/dsh-better-display/tree/reader-narration-0.3.4)，版本 `0.3.4-yishu.reader.2`。它是自有维护副本，不代表上游发布，也不会混入本播报 npm 包。

- 在 `lib/protocol.js` 的共用 `publicTextSegments` 接口分段：普通正文、显式播报、思考、其他块，保留源块位置和字符偏移；键不含文本、分类或结束位置，避免流式增长重挂载。原进度协议接口继续保留。
- Reader 在 `projection.ts` / `live-turn.ts` 直接把公开文本放进源顺序步骤流。公开文本分隔思考／工具折叠区，始终展开；新正文到达即解除流程动画等待。取消顶部 `ReaderNarrations` 汇总和 `Blocks.tsx` 的下游过滤。
- 投影时排除空文本、空思考及已知空状态行，保留媒体、未知内容及真实状态。折叠时隐藏步骤外层，不只清空内层；结束、取消或后台恢复后不应遗留高度。
- 原生聊天只豁免插件自己登记的公开文本消息行；停用／卸载恢复宿主当前隐藏状态。Reader 挂载时仍由 Reader 独占折叠。
- 共用协议副本注明0.4.0来源和校验值，并测试 Host `type`、视图 `kind` 输入的一致结果。构建后安装实际 `lib/`，不能只改源码。

| 视图 | 支持范围 |
| --- | --- |
| 原生“对话” + narrator 0.4.0 | 普通正文／播报原位显示、折叠豁免、前缀隐藏；关闭后恢复宿主策略 |
| 上游未适配 Reader 0.3.4 | narrator 让出折叠所有权；Reader 仍可能折叠正文、显示前缀，不承诺原位融合 |
| 自有 Reader 0.3.4-yishu.reader.2 | 共用分段、公开文本原位展开、空步骤排除、折叠外层回收；保留 Windows 图片修复 |

本轮验收包含顺序、纯播报／混合正文、无重复、空步骤增量高度、反复折叠及取消、流式增长、停止／历史、媒体、最终复制及分支。旧适配在隔离夹具留下25px空行；真实用户会话冷重载未复现原大空白，因此不能把该现场的唯一根因写成已确认。维护记录分别保存原会话测量、夹具复现与安装验收。

## 进度行协议

模型工作说明使用顶层独占行：

```text
📌 进度：我正在核对配置并验证下一步结果。
```

前缀只用于识别，客户端展示时不显示图标或前缀。代码围栏、列表、引用、缩进和常见 HTML 示例不会被识别。兼容顶层 ATX 标题、段落、中英文冒号和成对加粗形式。

## 安装

`0.4.0` 本轮通过源码仓库 `main` 同步及本地构建包交付；未自动发布到 npm。Desktop“插件 → 添加插件”可使用 `github:S-AN-Shu/dsh-progress-narrator` 或本地0.4.0包；Web CLI 使用 `dsh plugin --profile web add github:S-AN-Shu/dsh-progress-narrator`。下面npm0.3.0示例属于已发布旧版，不含此次融合修复。

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
