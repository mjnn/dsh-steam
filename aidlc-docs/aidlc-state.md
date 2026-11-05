# aidlc-state

> AI-DLC 工作流状态跟踪。每完成一个 bolt（一次变更）就更新本文件。

## 项目

| 项 | 值 |
|---|---|
| 名称 | dsh-steam |
| 类型 | brownfield（在 v0.2.0 上重构） |
| 当前版本 | 0.3.0 |
| 工作区 | `C:\Users\87779\.dsh\im\projects\dsh-steam` |
| 角色 | 需求与验收：Coding Agent（DSH）· 实现：Cursor · 决策：用户 |

## 阶段进度

| 阶段 | 状态 | 产物 |
|---|---|---|
| Inception · 需求 | ✅ 完成 | `inception/requirements/requirements.md`（源自 SPEC.md） |
| Inception · 设计 | ✅ 完成 | `inception/application-design/components.md` |
| Construction · 实现 | ✅ 完成 | `lib/**`（8 个模块） |
| Construction · 构建与测试 | ✅ 完成 | `construction/build-and-test/build-and-test-summary.md` |
| Operations | ⏳ 未开始（发布到 npm 后再补） |

## Bolt 记录

| # | 日期 | 内容 | 结果 |
|---|---|---|---|
| B1 | 2026-11-05 | 从零实现 6 工具插件 v0.1.x | 装不上（参数格式 + inject）→ 修复 |
| B2 | 2026-11-05 | v0.2.0 全绿 | 通过 |
| B3 | 2026-11-05 | 重构重写 v0.3.0（Cursor 实现） | 首次验收驳回（库路径大小写导致数据翻倍）→ Cursor 修复 → 通过 |
| B4 | 2026-11-05 | 引入 AI-DLC 物料与治理规则 | 本文件即为产物 |

## 当前门禁

- 发布前必须：`node test/selftest.mjs` 通过 + `release/<version>/manifest.json` 产出
- 详见 `MATERIAL-GOVERNANCE.md` 第 7 节

## 未决事项

1. `steam_library` 需要 Steam Web API Key，尚未配置
2. 尚未发布到 npm（包名 `dsh-steam` 可用）
3. Operations 阶段（监控/回滚）待补
