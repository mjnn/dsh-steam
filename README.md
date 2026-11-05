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
| `steam_download_status` | 否 | 读本机 Steam 目录：安装/下载进度/待更新/磁盘剩余/体积排行 |
| `steam_install` | 否 | 调 `steam://install/<appid>` 让 Steam 立刻开始下载 |
| `steam_library` | 是 | 查账号游戏库、总时长、玩得最多的 Top N |

价格历史默认写在 `~/.dsh/steam-price-history.json`，可用环境变量 `DSH_STEAM_HISTORY` 覆盖路径。
它记录的是**本插件观测到的价格**，不是 Steam 官方历史数据；首次运行时没有基线，第一天的价格会被当作「史低」。

## 安装（本地路径）

插件还没发布到 npm，用本地源码目录或 `node tools/release.mjs` 产出的 tgz 安装：

**方式一：插件管理界面**

1. 打开 DSH → 设置 → 插件管理 → 安装
2. 输入本仓库的**绝对路径**，或打好的包路径（把 `<repo>` 换成你本机的仓库根目录）：
   ```
   <repo>
   <repo>\dsh-steam-0.3.0.tgz
   ```
3. 确认识别到包名 `dsh-steam`，完成安装
4. **重启 DSH** 让宿主加载插件

**方式二：命令行**

```powershell
pnpm add "<repo>" --dir "<dsh-profile-dir>"
```

然后确认该 profile 的 `package.json` 里 `dsh.profile.bundles` 含有 `dsh-steam`，最后重启 DSH。

## 配置

| 字段 | 说明 |
|---|---|
| `apiKey` | Steam Web API Key，只有 `steam_library` 需要 |
| `steamId` | SteamID64，省略则每次调用时传 `steamid` / `vanity` |
| `cc` | 默认商店区域，缺省 `cn` |

API Key 也可以放在环境变量 `DSH_STEAM_API_KEY` 里。
申请地址：<https://steamcommunity.com/dev/apikey>（免费，域名随便填）。

## 已知限制

- **购买不在能力范围内**：Steam 没有公开的购买/结算 API，加购物车和付款仍要人工。
- `steam_library` 依赖「游戏详情」隐私设置为公开，否则 Steam 返回空列表。
- `steam_install` 只是把 `steam://install/<appid>` 交给系统；Steam 没运行或没登录时不会生效。
- 商店接口是非官方公开端点，Steam 改版可能失效；调用失败会返回可读错误而不是抛异常。

## 自检

不安装也能验证：用一个桩替代 `@deepseek-ai/dsh-tools`，在临时目录里跑真实的网络请求。

```powershell
node test\selftest.mjs
```

预期输出 4 个工具注册成功、`steam_price` 返回真实价格、`steam_install --dryRun` 不真的启动 Steam。

## License

MIT

