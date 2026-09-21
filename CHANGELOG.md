# Changelog

## 0.2.1 — 2026-09-21

- 要求模型在首次实际工作前先输出一句简短工作说明；若首步直接调用工具，下一边界补一次提醒。
- 设置页增加“首次工作先说明”开关。

## 0.2.0 — 2026-09-21

- Added quiet Host + Client progress narration with bounded reminders and backoff.
- Added persistent settings for cadence, folding, narration style and the optional status panel.
- Added official-view progress rendering, basic native folding and better-display Reader ownership detection.
- Added authenticated health, state and settings routes through the DSH Connection service.
- Added parser and state-machine regression coverage.
