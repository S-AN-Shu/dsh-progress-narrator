# Contributing

请先说明目标 DSH/Harness 版本和影响范围。修改客户端时编辑 `src/client.js`，再运行 `npm run build` 生成 `lib/client.js`；不要手工编辑生成文件。

提交前运行：

```powershell
npm test
npm run check
npm run build
npm pack --dry-run
```

不要提交 `node_modules`、`.bak` 文件、DSH 本机 profile、会话数据、令牌或维护目录。涉及 better-display Reader 的改动应在 better-display 上游仓库（或你自己的 fork）中完成，本仓库只保留检测逻辑与兼容说明，不复制 Reader 源码。
