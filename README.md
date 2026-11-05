# dsh-steam

仓库：https://github.com/mjnn/dsh-steam

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）用的 Steam 工具集。
装好之后，父模型可以直接查价、查库、触发下载、盯折扣，不用再截图点鼠标。

## 工具

| 工具 | 需要 API Key | 说明 |
|---|---|---|
| `steam_price` | 否 | 批量查现价 / 原价 / 折扣 / 发售日（商店公开接口） |
| `steam_search` | 否 | 按名字搜商店，把游戏名换成 appid |
| `steam_watch` | 否 | 折扣监控 + 本地价格历史（判断是否刷新史低） |
| `steam_deals` | 否 | 今日特惠 / 热销 / 新品榜（每日推送用） |
| `steam_specs` | 否 | PC 最低/推荐配置（剥 HTML） |
| `steam_news` | 否 | 游戏更新公告 / 补丁说明 |
| `steam_price_history` | 否 | 本机观测价格轨迹与史低（纯本地） |
| `steam_players` | 否 | 当前在线人数 |
| `steam_achievements_global` | 否 | 全球成就完成率（升序，最难在前） |
| `steam_media` | 否 | 截图 / 预告片 URL（不下载） |
| `steam_dlc` | 否 | DLC 列表 + 限量查价 |
| `steam_open` | 否 | `steam://` 打开商店 / 运行游戏（白名单） |
| `steam_download_status` | 否 | 读本机 Steam 目录：安装/下载进度/待更新/磁盘剩余/体积排行 |
| `steam_install` | 否 | 调 `steam://install/<appid>` 让 Steam 立刻开始下载 |
| `steam_library` | 是 | 查账号游戏库、总时长、玩得最多的 Top N |
| `steam_friends` | 是 | 好友列表与在线状态 |
| `steam_achievements` | 是 | 个人成就进度 |
| `steam_wishlist` | 是 | 愿望单 + 补价 |
| `steam_achievement_schema` | 是 | 成就内部名 → 中文名/描述 |
| `steam_recent` | 是 | 近两周在玩与时长 |
| `steam_level` | 是 | Steam 等级 / 经验 / 徽章 |

价格历史默认写在 `~/.dsh/steam-price-history.json`，可用环境变量 `DSH_STEAM_HISTORY` 覆盖路径。
它记录的是**本插件观测到的价格**，不是 Steam 官方历史数据；首次运行时没有基线，第一天的价格会被当作「史低」。

## 安装（本地路径）

插件还没发布到 npm，用本地源码目录或 `node tools/release.mjs` 产出的 tgz 安装：

**方式一：插件管理界面**

1. 打开 DSH → 设置 → 插件管理 → 安装
2. 输入本仓库的**绝对路径**，或打好的包路径（把 `<repo>` 换成你本机的仓库根目录）：
   ```
   <repo>
   <repo>\dsh-steam-0.8.1.tgz
   ```
3. 确认识别到包名 `dsh-steam`，完成安装
4. **重启 DSH** 让宿主加载插件

**方式二：命令行**

```powershell
pnpm add "<repo>" --dir "<dsh-profile-dir>"
```

然后确认该 profile 的 `package.json` 里 `dsh.profile.bundles` 含有 `dsh-steam`，最后重启 DSH。

## 配置

| 字段 / 环境变量 | 说明 |
|---|---|
| `apiKey` / `DSH_STEAM_API_KEY` | Steam Web API Key（账号类工具需要） |
| `steamId` / `DSH_STEAM_ID` | SteamID64，**可省略**——会自动识别本机 Steam 最近登录账号 |
| `cc` | 默认商店区域，缺省 `cn` |
| `DSH_STEAM_HISTORY` | 价格历史文件路径（可选） |

`steamid` 解析顺序：参数 → vanity → 插件配置 → `DSH_STEAM_ID` → 本机 `loginusers.vdf`（MostRecent=1）。

申请 Key：<https://steamcommunity.com/dev/apikey>（免费，域名随便填）。

运维与排障见 [`aidlc-docs/operations/operations.md`](aidlc-docs/operations/operations.md)。

## 已知限制

- **购买不在能力范围内**：Steam 没有公开的购买/结算 API，加购物车和付款仍要人工。
- `steam_library` 依赖「游戏详情」隐私设置为公开，否则 Steam 返回空列表。
- `steam_install` 只是把 `steam://install/<appid>` 交给系统；Steam 没运行或没登录时不会生效。
- 商店接口是非官方公开端点，Steam 改版可能失效；调用失败会返回可读错误而不是抛异常。

## 自检

```powershell
node test\selftest.mjs
```

预期：21 个工具注册成功；有 Key 且本机已登录 Steam 时，`steam_library` 不传 steamid 也应成功。

## License

MIT
