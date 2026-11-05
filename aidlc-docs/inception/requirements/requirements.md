# 需求基线（Requirements）

> 来源：`SPEC.md`。本文件是 AIDLC 视角的**需求条目化**版本，每条都有唯一 ID，供追溯使用。
> 变更规则：改需求先改这里，再改 SPEC，最后改代码。

## 功能性需求

| ID | 需求 | 验收方式 |
|---|---|---|
| REQ-01 | `steam_price` 批量查价：现价/原价/折扣/发售日 | `selftest` 断言 `ok:true` 且条数正确 |
| REQ-02 | `steam_search` 名字→appid，空关键词返回 `ok:false` 不抛错 | `selftest` 断言搜到 `4115450` |
| REQ-03 | `steam_watch` 折扣监控 + 本地价格历史 + 史低判定 | `selftest` 二次调用 `historySaved:true` |
| REQ-04 | `steam_download_status` 本地读取安装/下载/待更新/磁盘 | `selftest` 读数 = 25 条 / 634.8 GB |
| REQ-05 | `steam_install` 通过 `steam://` 触发下载，`dryRun` 绝不启动 | `selftest` 断言 `launched:false` |
| REQ-06 | `steam_library` 查库（需 Key），无 Key 优雅降级 | `selftest` 断言 `ok:false` 且不抛 |

## 非功能性需求

| ID | 需求 | 验收方式 |
|---|---|---|
| REQ-07 | 零运行时依赖，纯 Node 内置模块 | `package.json.dependencies` 为空 |
| REQ-08 | 满足 DSH 插件契约（`inject`、扁平参数映射、`output.schema/render`） | 能装能跑；自检的 Proxy 模拟 inject 约束 |
| REQ-09 | 多库路径大小写不敏感去重、按 appid 去重 | `test/dedupe.test.mjs` + 三个对抗用例 |
| REQ-10 | 网络失败/脏文件不抛到宿主，统一 `ok:false + summary` | `safe()` 包裹 + 自检降级用例 |
| REQ-11 | 单价文件 ≤ 400 行，模块职责单一 | 行数检查（最大 221 行） |
| REQ-12 | 不写死本机路径、不写死密钥 | 代码审查 + manifest 扫描 |

## 追溯矩阵

| 需求 | 代码 | 测试 |
|---|---|---|
| REQ-01 | `lib/register-store-tools.js` (price) | `selftest` §1 |
| REQ-02 | `lib/register-store-tools.js` (search) | `selftest` §5 |
| REQ-03 | `lib/register-store-tools.js` (watch) + `lib/price-history.js` | `selftest` §2 / §7 |
| REQ-04 | `lib/register-local-tools.js` + `lib/steam-local.js` | `selftest` §6 |
| REQ-05 | `lib/register-local-tools.js` (install) + `lib/tool-helpers.js` | `selftest` §3 |
| REQ-06 | `lib/register-local-tools.js` (library) + `lib/steam-api.js` | `selftest` §4 |
| REQ-09 | `lib/steam-local.js` | `test/dedupe.test.mjs` |
