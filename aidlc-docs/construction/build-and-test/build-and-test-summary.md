# 构建与测试总结（Build and Test Summary）

> 版本：0.3.0 · 验收日期：2026-11-05 · 验收方：Coding Agent（DSH）

## 1. 构建

| 项 | 值 |
|---|---|
| 构建方式 | `tar -czf`（无编译步骤，纯 ESM 源码） |
| 产物 | `dsh-steam-0.3.0.tgz`（16.2 KB，8 个 lib 文件） |
| 依赖 | 无（`dependencies: {}`） |
| Node | v24.21.0（DSH 自带运行时） |

## 2. 测试命令与结果

| 命令 | 结果 |
|---|---|
| `node --check lib/*.js`（8 个文件） | ✅ 全部 OK |
| `node test/dedupe.test.mjs`（直接执行） | ✅ 1 passed |
| `node test/selftest.mjs` | ✅ 通过，6 个工具全部注册 |

> 说明：`node --test <file>` 在验收方沙盒里会 `spawn EPERM`（沙盒禁止管道），
> 因此改为直接执行测试文件；这在 CI 或普通终端下不受影响。

## 3. 关键读数

```
注册工具：steam_download_status / steam_install / steam_library
         / steam_price / steam_search / steam_watch
本地扫描：25 个条目，已安装 25，下载中 0，待更新 6，占用 634.8 GB
价格查询：艾尔登法环 ¥298.00 / 影之刃零 ¥268.00 / CS2 免费
搜索：影之刃 → appid 4115450
价格历史：二次调用 historySaved=true
```

## 4. 被驳回的一轮（B3 首次验收）

| 现象 | 根因 | 修复 |
|---|---|---|
| 条目数 50 / 1269.5 GB（应为 25 / 634.8） | 库路径去重区分大小写：注册表小写 vs VDF 正常大小写 → 同库扫两遍 | `realpathSync.native` 去重 + appid 去重 + 回归测试 |

对抗性复验（验收方独立构造）：

| 用例 | 期望 | 实测 |
|---|---|---|
| 同路径大小写两种写法 | 1 库 / 1 app | ✅ |
| 两库含同一 appid | 2 库 / 1 app | ✅ |
| 两库不同 appid | 2 / 2，counts 正确 | ✅ |

## 5. 遗留风险

1. `steam_library` 未经真实 Key 验证（当前只验证了“无 Key 优雅降级”）
2. Steam 商店接口非官方，改版即失效（已在 SPEC 标注）
3. 价格历史首日会把当前价记为“史低”，需至少两周样本才有参考价值
