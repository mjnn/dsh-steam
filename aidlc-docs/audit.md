# audit

> 追加型审计记录：只增不改。ISO 8601 时间戳（Asia/Hong_Kong）。

## 2026-11-05

| 时间 | 角色 | 事件 | 结果 |
|---|---|---|---|
| 19:30 | 用户 | 要求用 Cursor 写代码，Agent 写 spec、测试、验收 | 确立分工 |
| 19:33 | Agent | 产出 `SPEC.md`（6 工具行为契约 + 硬约束 + 验收清单） | ✅ |
| 19:34 | Cursor | 实现 v0.3.0（8 模块），自检通过 | 待验收 |
| 19:36 | Agent | 独立验收：语法 8/8 OK、自检通过，但发现**条目数翻倍**（50/1269.5GB vs 真实 25/634.8GB） | ❌ 驳回 |
| 19:37 | Agent | 复现根因：`Set` 去重区分大小写，注册表小写路径与 VDF 大小写被当成两个库 | 证据确凿 |
| 19:38 | Agent | 更新 `SPEC.md` 3.4 节，明确“大小写不敏感去重 + appid 去重” | ✅ |
| 19:41 | Cursor | 修复：`realpathSync.native` 去重、appid 去重、新增 `test/dedupe.test.mjs` | 待验收 |
| 19:43 | Agent | 复验：语法 8/8、dedupe 测试通过、自检读数 25/634.8GB、三个对抗用例全绿 | ✅ 通过 |
| 19:45 | Agent | 打包 `dsh-steam-0.3.0.tgz`（16.2 KB，8 文件） | ✅ |
| 19:55 | 用户 | 要求代码演进符合 AWS AI-DLC、并具备物料治理意识 | 进行中 |
| 19:58 | Agent | 建立 `aidlc-docs/`（state / requirements / components / build-and-test / governance） | ✅ |

## 待记录

- 用户实际安装 0.3.0 并确认工具可用
- Operations 阶段：发布 npm 后的回滚与监控约定
