# 应用设计（Application Design）

> 单 unit 项目：`dsh-steam` 一个包，8 个模块。工具名与职责的对应关系是本文件的核心。

## 分层

```
lib/index.js                 入口：name / inject / apply
  └── lib/register-tools.js  汇总注册
        ├── lib/register-store-tools.js   网络类工具（price / search / watch）
        └── lib/register-local-tools.js   本地类工具（download_status / install / library）
              ├── lib/steam-api.js        网络层（商店 API + Web API）
              ├── lib/steam-local.js      本地层（VDF/ACF 解析）
              ├── lib/price-history.js    历史层（价格样本 + 史低判定）
              └── lib/tool-helpers.js     共用（render / safe / steam:// 唤起）
```

## 组件职责

| 组件 | 职责 | 不做什么 |
|---|---|---|
| `index.js` | 导出 `name` / `inject` / `apply`，把 `cfg` 传给注册器 | 不写业务逻辑 |
| `register-tools.js` | 调用两个注册器 | 不定义工具 |
| `register-store-tools.js` | 定义 3 个网络工具 + summary 文案 | 不发请求（委托 `steam-api`） |
| `register-local-tools.js` | 定义 3 个本地工具 | 不解析文件（委托 `steam-local`） |
| `steam-api.js` | HTTP + 数据规整 + 超时 | 不做格式化展示 |
| `steam-local.js` | 探测根目录、解析 VDF/ACF、去重、汇总 | 不碰网络 |
| `price-history.js` | 读写 `~/.dsh/steam-price-history.json`、判定新低 | 不查价 |
| `tool-helpers.js` | `renderResult` / `looseOutput` / `safe` / `launchSteamUrl` | 不感知具体工具 |

## 关键决策

| 决策 | 理由 |
|---|---|
| `parameters` 用扁平属性映射 | DSH 的编译契约；写成完整 JSON Schema 会被拒 |
| 数组参数用 `type:'json'` | DSH 只支持 string/number/integer/boolean/json |
| 所有 `execute` 包 `safe()` | 网络抖动不应打穿宿主会话 |
| 库路径 `realpathSync.native` 去重 | 注册表小写 vs VDF 大小写会导致数据翻倍（B3 实测） |
| 价格历史独立文件 | 与插件解耦，损坏可删，不拖垮工具 |
| `launchSteamUrl` 只拼数字 | 防注入；URL 不接受任意字符串 |

## 数据流

```
steam_watch
  → steam-api.fetchPrices（HTTP）
  → price-history.recordPrice（读写 JSON）
  → 里程碑标记（🔥 历史新低 / 史低 ¥x）
```

## 错误边界

| 层 | 失败表现 | 兜底 |
|---|---|---|
| `steam-api` | 网络/HTTP/JSON 错 | 抛带中文描述的 Error |
| `steam-local` | 文件缺失/损坏 | 跳过该文件，继续扫 |
| `price-history` | 读写失败 | 返回空库 / `historySaved:false` |
| 工具层 | 任何未捕获异常 | `safe()` → `ok:false + summary` |
