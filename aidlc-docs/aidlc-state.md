# aidlc-state

> AI-DLC 工作流状态跟踪。每完成一个 bolt（一次变更）就更新本文件。

## 项目

| 项 | 值 |
|---|---|
| 名称 | dsh-steam |
| 类型 | brownfield |
| 当前版本 | 0.9.1 |
| 工作区 | 仓库根（勿写死用户绝对路径） |
| 角色 | 需求与验收：Coding Agent（DSH）· 实现：Cursor · 决策：用户 |

## 阶段进度

| 阶段 | 状态 | 产物 |
|---|---|---|
| Inception · 需求 | ✅ | `inception/requirements/requirements.md` |
| Inception · 设计 | ✅ | `inception/application-design/components.md` |
| Construction · 实现 | ✅ | `lib/**`（21 工具） |
| Construction · 构建与测试 | ✅ | `construction/build-and-test/`、`test/`、`tools/release.mjs` |
| Operations | ✅ | `operations/operations.md`、`CHANGELOG.md` |

## Bolt 记录（摘要）

| # | 日期 | 内容 | 结果 |
|---|---|---|---|
| B1–B3 | 2026-11-05 | v0.1→0.3 实现、翻倍 bug、治理 | ✅ |
| … | 2026-11-05 | v0.4–0.8 扩工具面至 21 | ✅ |
| B1' | 2026-11-05 | 统一 steamid 兜底（0.8.1） | 进行中 |
| B4 | 2026-11-05 | Operations 物料 | 进行中 |

## 当前门禁

- `node test/selftest.mjs` 通过 + `release/<version>/manifest.json`
- 工具数 = 21；详见 `MATERIAL-GOVERNANCE.md` §7、`operations/operations.md`
