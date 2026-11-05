# MATERIAL GOVERNANCE · 物料治理规则

> 适用范围：`dsh-steam` 项目（以及后续同构插件项目）。
> 目标：任何时刻都能回答三个问题——**这是什么版本、它从哪来、它验证过吗**。

## 0. 分工约定（谁写代码）

| 场景 | 谁写 | 为什么 |
|---|---|---|
| **完整项目 / 插件 / 有外部契约的交付物** | **Cursor** | 有结构、有验收、要长期演进，需要独立的实现方来交叉验证 |
| 一次性小脚本（查询、转换、临时工具，≤ 100 行） | Agent 直接写 | 成本低于写任务书；用完可弃 |
| 文档、SPEC、评审意见、验收脚本 | Agent | 属于需求与治理职责，不是实现 |
| 测试与验收 | Agent（不可委托给实现方） | 自己验自己等于没验 |

约束：
- 走 Cursor 的项目，Agent **不直接改 `lib/**`**；发现问题写成任务书退回，由 Cursor 改。
- 小脚本若后来被固化进项目，应迁移到 Cursor 名下重写或至少补一次独立评审。

## 1. 物料分级

| 级别 | 物料 | 位置 | 谁维护 | 是否入库 |
|---|---|---|---|---|
| L1 需求基线 | `SPEC.md` | 项目根 | 需求方（Agent） | ✅ |
| L2 过程产物 | `aidlc-docs/**` | 项目根 | 需求方 + 实现方 | ✅ |
| L3 实现 | `lib/**`、`package.json`、`cordis.patch.yml` | 项目根 | 实现方（Cursor） | ✅ |
| L4 验证 | `test/**` | 项目根 | 需求方 | ✅ |
| L5 发布物 | `dsh-steam-<version>.tgz` + `release/<version>/manifest.json` | 项目根 / `release/` | 构建脚本 | ❌（产物，不入库） |

**唯一事实源**：需求看 L1，实现看 L3，验收看 L4，别人拿到的东西看 L5 的 manifest。

## 2. 版本与命名

1. 语义化版本 `MAJOR.MINOR.PATCH`：
   - PATCH：修 bug、改文案，行为不变
   - MINOR：新增工具或新增字段（向后兼容）
   - MAJOR：破坏性变更（改工具名、改参数契约）
2. `package.json.version` 是**唯一版本号来源**；README、manifest、tgz 文件名都从它派生。
3. 发布物命名固定：`dsh-steam-<version>.tgz`，不允许出现 `-final`、`-new`、`-副本`。
4. 任何版本号不一致（package.json vs 文件名 vs manifest）→ **拒绝构建**。

## 3. 发布物清单（manifest）

每次构建必须在 `release/<version>/manifest.json` 产出：

```json
{
  "name": "dsh-steam",
  "version": "0.3.0",
  "builtAt": "2026-11-05T12:00:00.000Z",
  "tgz": "dsh-steam-0.3.0.tgz",
  "sha256": "<tgz 的 sha256>",
  "files": [{ "path": "lib/index.js", "bytes": 1064, "sha256": "..." }],
  "spec": { "path": "SPEC.md", "sha256": "..." },
  "tests": { "cmd": "node test/selftest.mjs", "passed": true, "finishedAt": "..." },
  "toolNames": ["steam_price", "steam_search", "steam_watch",
                "steam_download_status", "steam_install", "steam_library"]
}
```

规则：
- `files` 必须覆盖 tgz 内每个文件（内容清单 + 哈希）
- `tests.passed` 必须为 `true` 才允许产出发布物
- `toolNames` 从实际注册结果取，不能手写

## 4. 追溯链

必须能单向追到底：

```
需求条目（SPEC 第 3 节）
  → 设计组件（aidlc-docs/inception/application-design/components.md）
  → 代码文件（lib/register-*.js）
  → 测试断言（test/selftest.mjs 的对应断言）
  → 发布物（release/<version>/manifest.json 的 sha256）
```

新增一个工具时，上面五处都要有对应痕迹；任一缺失视为“物料不完整”，不得发布。

## 5. 变更控制

1. 一次变更 = 一个 **bolt**（AIDLC 术语），一个 bolt 只做一件事。
2. 每个 bolt 结束必须更新：
   - `aidlc-docs/aidlc-state.md`（阶段进度）
   - `aidlc-docs/audit.md`（追加一条：时间、变更、验收结果）
3. 变更若影响行为契约 → **先改 SPEC**，再改代码。
4. 破坏性变更必须写迁移说明（README 的“升级须知”）。

## 6. 保留与清理

| 物料 | 保留策略 |
|---|---|
| `SPEC.md` / `aidlc-docs/**` | 永久保留，随代码入库 |
| 发布物 tgz | 只保留最近 **3 个版本**，其余删除（manifest 永久保留） |
| 临时调试脚本 | 不入库，用完即删 |
| 过期文档 | 移入 `archive/<YYYY-MM-DD>/`，**不直接删除** |
| 本机路径 / Key | 任何物料里都不得出现 |

## 7. 入库前检查（人工 + 脚本双保险）

- [ ] 版本号三处一致
- [ ] `node --check` 全部通过
- [ ] 自检通过，且 `toolNames` 与 SPEC 一致
- [ ] manifest 里每个文件都能追溯到代码
- [ ] 没有密钥、没有本机绝对路径（`C:\Users\<name>` 之类）
- [ ] README 的安装路径与实际产物一致
