# Operations · dsh-steam 运维手册

> 版本：与 `package.json.version` 对齐（当前见仓库根）。  
> 角色：需求与验收（Agent）· 实现（Cursor）· 决策（用户）。

## 1. 安装与升级

### 1.1 本地 tgz 安装（推荐）

1. 在仓库根执行 `node tools/release.mjs`，得到 `dsh-steam-<version>.tgz`。
2. DSH → 设置 → 插件管理 → 安装，填入 tgz **绝对路径**；或：
   ```powershell
   pnpm add "<repo>\dsh-steam-<version>.tgz" --dir "<dsh-profile-dir>"
   ```
3. 确认 profile 的 `dsh.profile.bundles` 含 `dsh-steam`，**重启 DSH**。

也可直接安装源码目录（开发用）：路径指向仓库根即可。

### 1.2 版本升级

1. 拉取 / 检出目标版本代码。
2. 再跑 `node tools/release.mjs` 产出新 tgz。
3. 用新 tgz 覆盖安装（或先卸旧版再装），重启 DSH。
4. 对照 `release/<version>/manifest.json` 的 `toolNames.length`（应为 **21**）与 `sha256`。

### 1.3 回滚到上一版

1. 打开 `release/<旧版本>/manifest.json`，记下 `tgz` 文件名与 `sha256`。
2. 若项目根仍保留对应 `dsh-steam-<旧版>.tgz`（脚本只保留最近 3 个 tgz），用该文件重装。
3. 若 tgz 已被清理：从 git tag / 发布历史检出旧版源码后重新 `node tools/release.mjs`，或从备份取回同 sha256 的包。
4. **manifest 目录永久保留**，用它核对哈希，避免装错包。

## 2. 配置项

| 项 | 来源 | 必填？ | 说明 |
|---|---|---|---|
| `apiKey` | 插件配置 | 账号类工具必填* | Steam Web API Key |
| `DSH_STEAM_API_KEY` | 环境变量 | 同上（与 apiKey 二选一） | 优先于空配置时的兜底 |
| `steamId` | 插件配置 | 可选 | SteamID64；省略则自动解析 |
| `DSH_STEAM_ID` | 环境变量 | 可选 | 覆盖 / 兜底 steamId |
| `cc` | 插件配置 | 可选 | 默认商店区，缺省 `cn` |
| `DSH_STEAM_HISTORY` | 环境变量 | 可选 | 价格历史 JSON 路径；默认 `~/.dsh/steam-price-history.json` |

\*免 Key 工具（查价、搜索、特惠、媒体、本机下载状态等）不需要 Key。  
\*需 Key：`steam_library` / `friends` / `achievements` / `wishlist` / `achievement_schema` / `recent` / `level`。

### steamid 解析顺序（统一）

```
args.steamid → args.vanity → config.steamId → DSH_STEAM_ID → 本机 loginusers.vdf（MostRecent=1）
```

实现：`lib/local-steamid.js` 的 `resolveSteamid(apiKey, args, cfg)`。  
**可省略 steamid**：本机已登录 Steam 时会自动识别最近账号。

## 3. 排障

| 症状 | 可能原因 | 处置 |
|---|---|---|
| `缺少 Steam Web API Key` | 未配置 apiKey / 环境变量 | 到 https://steamcommunity.com/dev/apikey 申请，写入配置或 `DSH_STEAM_API_KEY` |
| `无法解析 steamid` | 未传参且本机无 MostRecent 登录 | 传 `steamid`，或设 `steamId` / `DSH_STEAM_ID`，或登录 Steam 客户端 |
| `没找到 Steam 安装目录` | 非默认盘 / 便携版 / 非 Windows | 确认安装；Windows 检查注册表 `HKCU\Software\Valve\Steam\SteamPath` |
| `价格历史写入失败` / `historySaved:false` | 目录无写权限或只读沙盒 | 设 `DSH_STEAM_HISTORY` 到可写临时目录 |
| 网络超时 / HTTP 429 | 商店限流或网络差 | 稍后重试；单次超时 ≤15s，工具级 ≤60s |
| 库条目数异常翻倍 | 旧版路径大小写去重 bug | 升级到 ≥0.3.0（含 realpath / 大小写不敏感去重） |
| `steam_library` 返回 0 游戏 | 隐私「游戏详情」非公开 | 个人资料 → 隐私设置改为公开 |
| CI 上 download_status SKIP | Runner 无 Steam | 预期行为；自检会打印 `SKIP steam_download_status` |

## 4. 监控点

| 点 | 如何看 | 健康标准 |
|---|---|---|
| CI | GitHub Actions `ci.yml`（Node 22.x / 24.x） | push/PR 全绿（含 `node tools/release.mjs`） |
| 自检 | `node test/selftest.mjs` | 退出码 0；工具数 **21** |
| 去重单测 | `node --test test/*.test.mjs` | pass |
| 打包产物冒烟 | `release.mjs` 闸门 7 / manifest.`verify` | `packedSmoke=true`；`toolCount=21` |
| 发布清单 | `release/<ver>/manifest.json` | `tests.passed=true`；`toolNames.length===21` |
| 包完整性 | manifest.`sha256` vs tgz | 一致 |
| 自检耗时 | release 摘要 / 本地计时 | 通常数秒级；异常拉长查网络 |

## 5. 回滚速查

1. `release/` 下列出历史版本目录（永久保留）。
2. 打开目标版本 `manifest.json` → 取 `tgz` + `sha256`。
3. 用对应 tgz 重装并校验哈希。
4. 若根目录 tgz 已被 prune（只留最近 3 个）：从 git 检出该 tag/commit 后重建，或从备份恢复。

## 6. 常用命令

```powershell
node --check lib/*.js
node --test test/*.test.mjs
node test/selftest.mjs
node tools/release.mjs
```
