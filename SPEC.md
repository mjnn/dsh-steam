# dsh-steam v0.3.0 · 实现规格（SPEC）

> 作者：Coding Agent（DeepSeek Harness）· 实现方：Cursor · 验收方：Coding Agent
> 本文件是实现契约。实现必须满足，验收逐条对照。

## 1. 目标

把现有的 `dsh-steam` 插件（v0.2.0）**重构重写**为 v0.3.0，保持 6 个工具的外部行为不变，同时：

- 代码结构更清晰（分层：网络层 / 本地层 / 历史层 / 工具层）
- 错误处理更稳（任何工具都不应因网络抖动或脏文件抛到宿主）
- 补充可读的中文注释与边界说明
- 全部通过验收测试

## 2. 硬性约束（违反即打回）

1. **零运行时依赖**：不得新增 `dependencies`；只允许 Node 内置模块。
2. **ESM**：`package.json` 保持 `"type": "module"`，入口 `lib/index.js`。
3. **插件契约**（DSH cordis）：
   - 必须 `export const inject = ['tools'];`（缺了报 `cannot get property "tools" without inject`）
   - 注册方式：`const dispose = ctx.tools.register(tool); ctx.effect?.(() => dispose);`
   - `defineTool({ name, description, parameters, output: { schema, render }, execute })`
   - **`parameters` 必须是「属性名 → 定义」的扁平映射**，不是完整 JSON Schema。
     错误写法：`parameters: { type:'object', properties:{...} }` → 报 `parameters.type must be a value schema object`
     正确写法：`parameters: { appids: { type:'json', required:true, description:'...' } }`
   - 允许的 `type`：`string` / `number` / `integer` / `boolean` / `json`
   - `required: true` 只能出现在属性定义里，且值必须是 `true`
   - `output.schema` 是值 schema（可以是 `{type:'object', properties:{...}}`），`output.render(args, value)` 返回 `[{ type:'text', text: string }]`
4. **包元数据**：`dsh.bundle.patch` 指向 `./cordis.patch.yml`；后者内容为
   ```yaml
   - insert:
       - id: dsh-steam
         name: dsh-steam
   ```
5. **不得写死本机路径**：Steam 根目录必须通过注册表 + 常见候选路径探测。
6. **工具名不得改**：`steam_price` / `steam_search` / `steam_watch` / `steam_download_status` / `steam_install` / `steam_library`。

## 3. 工具行为契约

### 3.1 `steam_price`
- 入参：`appids`（json 数组，必填）、`cc`（string，默认 `cn`）
- 出参：`{ ok, cc, items[], summary }`
- `items[i]`：`{ appid, ok, name, isFree, currency, finalCents, initialCents, finalText, initialText, discountPercent, releaseDate, developers, platforms, storeUrl }` 或 `{ appid, ok:false, error }`
- 单个 appid 失败不得影响其它 appid

### 3.2 `steam_search`
- 入参：`query`（string，必填）、`limit`（integer，默认 8，上限 50）、`cc`
- 出参：`{ ok, cc, total, items[], summary }`
- `items[i]`：`{ appid, name, type, currency, finalCents, initialCents, discountPercent, metascore, storeUrl }`
- 关键词为空 → 返回 `ok:false` 与可读说明，不要抛错

### 3.3 `steam_watch`
- 入参：`appids`（json 数组，必填）、`minDiscount`（integer，默认 1）、`cc`
- 行为：查价 → 记录价格历史 → 只返回折扣 ≥ 阈值的条目
- 出参：`{ ok, cc, checked, deals[], historySaved, summary }`
- `deals[i]` 额外带 `lowestCents` / `lowestText` / `isNewLow` / `firstSample`
- `summary` 中，新低标 `🔥 历史新低`，否则标 `史低 ¥xx`
- 历史写入失败只能降级（`historySaved:false`），不能让整个工具失败

### 3.4 `steam_download_status`
- 入参：`top`（integer，默认 10）
- 行为：读 `libraryfolders.vdf` + 各库 `appmanifest_*.acf`
- 出参：`{ ok, steamRoot, counts:{total,installed,downloading,needsUpdate}, totalGB, downloading[], needsUpdate[], topBySize[], libraries[{path,freeGB}], summary }`
- **判定口径**（必须一致）：
  - `installed` = StateFlags 含位 4
  - `needsUpdate` = StateFlags 含位 2
  - `downloading` = `BytesToDownload > 0 && BytesDownloaded > 0 && BytesDownloaded < BytesToDownload`
    （只比较前两者会把「有更新但没开始」误判成下载中）
- 找不到 Steam 目录 → `ok:false` + 说明，不抛错
- **去重要求（重要）**：
  - 库路径去重必须**大小写不敏感**（Windows）。注册表常见返回小写 `c:\program files (x86)\steam`，
    而 `libraryfolders.vdf` 里写的是正常大小写。若按字符串原样去重，同一个库会被扫两遍，
    导致条目数、占用空间**全部翻倍**。
  - 游戏条目按 `appid` 去重（多库残留同一 appid 时只保留一条）。
  - 判定口径不变，但去重是前置条件：先去重，再统计。
- **进度语义（v0.4.0 修正）**：`progressPercent` 只在 `downloading === true` 时给数值；
  非下载中（含 needsUpdate / 已安装）一律为 `null`。不要用 100 表示“没在下载”。

### 3.5 `steam_install`
- 入参：`appid`（integer，必填）、`dryRun`（boolean）
- 行为：`steam://install/<appid>`；Windows 用 `cmd /c start "" <url>`，macOS `open`，Linux `xdg-open`
- `dryRun:true` 只返回 `{ ok, appid, url, launched:false, summary }`，**绝不能真的启动**
- appid 非法 → `ok:false` + 说明
- 安全：URL 只由数字 appid 拼接，不接受任意字符串

### 3.6 `steam_library`
- 入参：`steamid`、`vanity`、`top`（integer，默认 20）
- 需要 Web API Key：优先插件配置 `config.apiKey`，其次环境变量 `DSH_STEAM_API_KEY`
- 无 Key → `ok:false` + 申请指引（不抛错）
- 有 Key 且返回 0 个游戏 → `ok:false` + 提示“资料可能未设为公开”

### 3.7 `steam_deals`（v0.4.0 新增）
- 目的：回答“今天有什么值得买”，供每日定时推送使用。**不需要 API Key**。
- 数据源：`store.steampowered.com/api/featuredcategories?cc=<cc>&l=schinese`
- 入参：`mode`（string，`specials` | `top` | `new`，默认 `specials`）、`limit`（integer，默认 10，上限 30）、`cc`
- 出参：`{ ok, cc, mode, items[], summary }`
- `items[i]`：`{ appid, name, finalCents, initialCents, discountPercent, currency, storeUrl }`
  - 价格字段单位为「分」；无价格（免费/未发售）时 `finalCents: null`
  - `discountPercent` 用 `original_price/final_price` 自行计算，不依赖接口给的字段
- 行为要求：
  - `mode` 非法 → `ok:false` + 列出可选值，不抛错
  - 接口返回空列表 → `ok:true` + `items:[]` + 说明性 summary（不算失败）
  - `specials` 模式默认只保留 `discountPercent > 0` 的条目
- summary 示例：`今日特惠 10 个：· 侠盗猎车手V ¥74.50（-50%）`

## 4. 价格历史存储

- 默认路径：`~/.dsh/steam-price-history.json`
- 覆盖：环境变量 `DSH_STEAM_HISTORY`（测试必须用它写到临时目录）
- 结构：
  ```json
  { "version": 1, "apps": { "<appid>": { "name": "", "currency": "CNY",
    "lowestCents": 0, "lowestDate": "YYYY-MM-DD", "samples": 0,
    "lastCents": 0, "lastSeen": "YYYY-MM-DD",
    "history": [{ "date": "YYYY-MM-DD", "cents": 0 }] } } }
  ```
- 同日重复查询只保留一条（覆盖当天价格）
- `history` 最多 90 条
- 文件损坏 → 当空库处理，不得抛错

## 5. 质量要求

- 所有网络调用有超时（单次 ≤ 15s，工具级 ≤ 60s）
- 错误信息必须是人能看懂的中文，包含“为什么”和“怎么办”
- 不吞异常到无声：外部失败要变成 `ok:false` + `summary`
- 注释说明“为什么这么做”，不要复述代码
- 单个文件不超过 400 行；超过就拆

## 6. 验收（逐条执行，全部通过才算完成）

1. `node --check` 四个模块全部通过
2. `node test/selftest.mjs` 通过，且：
   - 注册工具数 = 6
   - `steam_price` 对 `[730, 1245620]` 返回 `ok:true` 且条数正确
   - `steam_search` 搜「影之刃」返回包含 appid `4115450`
   - `steam_watch` 第二次调用 `historySaved:true`
   - `steam_install` 的 `dryRun:true` 返回 `launched:false`
   - `steam_library` 无 Key 时 `ok:false` 且不抛错
   - `steam_download_status` 能找到 Steam 根目录（本机存在）
3. 自检脚本必须能**在我（验收方）的沙盒环境**下跑通：网络可用、写入仅限临时目录
4. 交付前自己先跑一遍，把输出贴进汇报

## 7. 禁止事项

- 不新增外部依赖
- 不改包名 `dsh-steam`、不改工具名
- 不删除 `test/selftest.mjs` 的既有断言（可以新增）
- 不把密钥、绝对用户路径写进代码或 README
