# Changelog

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
