# Changelog

## 0.4.3 — 2026-10-26

- 修复 DSH `0.2.1-rc.3` 下客户端不接管聊天节点、工作说明裸显示 `📌 进度：`：宿主给 `assistant-step` 新增了 `conversation.chat.message.images` 子插槽，原"恰好一个子插槽"的判定改为"全部 single/session 且成员可渲染"，未知子插槽仍回退原生渲染。
- 图片子插槽转发到公共 `conversation.images.content` Content Factory，助手消息里的图片保持原生画廊。
- 归属校验不再依赖包名：压缩运行时里 `registrant` 是短 id（实测 `Gb`），改成"Body 占用者仍是默认形态 + 与节点条目同 registrant"。
- 真实界面验证：被接管的聊天节点 0 → 129，淡灰播报行 0 → 14，段首裸 `📌` 段落 7 → 0，播报行计算样式 `rgb(207,211,214) / 400 / 14px`。

## 0.4.2 — 2026-10-09

- 适配 DSH `0.2.1-alpha.2` 官方 reasoning Body 子插槽，通过公开 Content Factory 保留原生思考渲染和折叠，不重复声明子插槽。
- 第三方接管 Body 或未知子插槽时恢复完整原生渲染，避免越过插槽所有权；不依赖生产组件函数名。
- 保留 rc.2 的主开关立即保存、注入前读取最新配置和原生折叠修复。

## 0.4.1 — 2026-10-09

- 启用开关立即保存，无需另点“保存设置”；保留其他未保存字段，失败时恢复已保存状态。
- 每次请求接纳完成后重新读取动态配置，避免关闭期间仍使用旧缓存注入；状态和设置接口同样返回最新配置。
- 当前桌面端的原生展示模式独占思考和工具折叠，包括用户主动不折叠的选择和无 Turn 的历史工具行；旧版备用折叠只在缺少原生接口时启用。
- 停用只阻止后续新增控制消息，不删除或改写会话中的历史规则。

## 0.4.0

- 普通公开正文与播报按源顺序原位显示，过程折叠后保留；普通段落600，播报400，最终答复和媒体原样。
- 共用public-text v1分段；取消顶部汇总和下游过滤；空步骤提前排除，折叠回收外层高度。
- 公开更新绕过流程动画；普通正文取消首次补报并提供最多30秒缓冲，阶段播报保持120秒／6步及退避。
- 明确原生聊天、上游未适配Reader、自有适配分支以及Desktop/Web安装边界。保留Windows图片修复。
- 原生消息行按自身所属视图判定显示所有权，避免切出Reader时旧根节点使播报层继续让出；停用时恢复宿主隐藏状态。


## 0.3.0 — 2026-09-30

- 适配 DSH 0.2 的 scoped Cordis / Schemastery、公开 `session/event` 与 `agent/pre-step` 接口；兼容范围为 `>=0.2.0-rc.1 <0.3.0`，已验证内核为 `0.2.0-rc.2`。
- 设置使用当前 volatileRef 和 SettingsForms revision 接口；保留严格业务校验、认证 Connection 路由与冲突保护。
- 客户端依赖改为当前 `dsh-client-ui-chat` / `dsh-client-ui-renderer`；保留原生聊天插槽、进度协议、基础折叠与 Reader 所有权检测。
- 调整配置测试以验证动态引用、默认/reset 语义及严格业务边界。52 项原有测试全部通过，另通过 4 项当前内核隔离契约验证；真实浏览器、profile 持久化及模型执行需由部署环境单独验收。
- 保留公共包名 `dsh-progress-narrator` 和 bundle 条目 `progress-narrator`，发布包包含 BSD-3-Clause 许可，不包含本机验证记录。

## 0.2.2 — 2026-09-21

- 声明 `dsh.bundle.patch` 并在仓库根目录提供 `cordis.patch.yml`，使本插件可以作为标准 DSH bundle 安装（`dsh plugin add` 与目录市场分发都要求这一形态）。
- 新增 manifest 与 bundle patch 的结构性回归测试；README 安装章节改写为“bundle 安装”与“手工 insert”二选一。
- manifest 移除 `private` 标记并补 `keywords`，为发布到 npm 做准备（尚未发布）。
- 包名改为无 scope 的 `dsh-progress-narrator`，与 npm 包名、bundle patch 条目名和客户端 bundle id 对齐；客户端构建脚本改为从 `package.json` 读取 id，并新增一项断言 Host 插件 id/版本号跟随 manifest 的回归测试。

## 0.2.1 — 2026-09-21

- 要求模型在首次实际工作前先输出一句简短工作说明；若首步直接调用工具，下一边界补一次提醒。
- 设置页增加“首次工作先说明”开关。

## 0.2.0 — 2026-09-21

- Added quiet Host + Client progress narration with bounded reminders and backoff.
- Added persistent settings for cadence, folding, narration style and the optional status panel.
- Added official-view progress rendering, basic native folding and better-display Reader ownership detection.
- Added authenticated health, state and settings routes through the DSH Connection service.
- Added parser and state-machine regression coverage.
