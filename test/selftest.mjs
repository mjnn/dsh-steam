/**
 * 结构化自检：在隔离目录里用桩替代 @deepseek-ai/dsh-tools，
 * 验证 lib/index.js 的工具定义形状与 execute 行为。
 *
 * 做法：把 lib/ 复制到临时目录 + 放一个本地桩，避免真实项目里残留假依赖。
 */
import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = new URL('..', import.meta.url).pathname.replace(/^\//, '');
const TMP = join(process.env.TEMP ?? '/tmp', 'dsh-steam-selftest-' + Date.now());

const stubPackage = {
  name: '@deepseek-ai/dsh-tools',
  version: '0.0.0-stub',
  type: 'module',
  main: 'index.js',
  exports: { '.': './index.js' },
};

const stubSource = `
export function defineTool(options) {
  const need = ['name', 'description', 'parameters', 'output', 'execute'];
  for (const k of need) {
    if (options[k] === undefined) throw new Error('defineTool 缺少字段: ' + k);
  }
  if (typeof options.execute !== 'function') throw new Error('execute 必须是函数');
  if (!options.output || typeof options.output !== 'object') throw new Error('output 必须是对象');
  if (!('schema' in options.output)) throw new Error('output.schema 缺失');
  if (typeof options.output.render !== 'function') throw new Error('output.render 必须是函数');

  // 模拟真实编译器的关键约束：parameters 是「属性名 → 属性定义」的映射，
  // 每个定义必须是带 type 的对象；写成 {type:'object', properties:{...}} 会挂。
  const spec = options.parameters ?? {};
  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('parameters 必须是对象映射');
  }
  const ALLOWED = new Set(['string', 'number', 'integer', 'boolean', 'json']);
  for (const [k, v] of Object.entries(spec)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      throw new Error('参数 ' + k + ' 必须是值 schema 对象（现在拿到 ' + JSON.stringify(v) + '）');
    }
    if (typeof v.type !== 'string' || !ALLOWED.has(v.type)) {
      throw new Error('参数 ' + k + '.type 无效：' + JSON.stringify(v.type));
    }
    if ('required' in v && v.required !== true) {
      throw new Error('参数 ' + k + '.required 只能是 true 或省略');
    }
  }
  return { ...options, __stub: true };
}
`;

async function main() {
  await mkdir(join(TMP, 'node_modules/@deepseek-ai/dsh-tools'), { recursive: true });
  await cp(new URL('../lib', import.meta.url), join(TMP, 'lib'), { recursive: true });
  await writeFile(join(TMP, 'node_modules/@deepseek-ai/dsh-tools/package.json'), JSON.stringify(stubPackage, null, 2));
  await writeFile(join(TMP, 'node_modules/@deepseek-ai/dsh-tools/index.js'), stubSource);
  await writeFile(join(TMP, 'package.json'), JSON.stringify({ name: 'dsh-steam-selftest', type: 'module' }, null, 2));

  const mod = await import(pathToFileURL(join(TMP, 'lib/index.js')).href);

  // 模拟 cordis 的 inject 约束：没在 inject 里声明的服务，访问就抛错。
  // 真实报错文案：cannot get property "tools" without inject
  const declared = new Set(Array.isArray(mod.inject) ? mod.inject : []);
  const services = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
    },
  };
  const tools = new Map();

  const ctx = new Proxy({ effect() {} }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop in services) {
        if (!declared.has(prop)) {
          throw new Error(`cannot get property "${String(prop)}" without inject`);
        }
        return services[prop];
      }
      return undefined;
    },
  });

  if (!declared.has('tools')) throw new Error("插件没有在 inject 里声明 'tools'");

  // 把价格历史写到临时目录，避免污染真实用户目录，也绕开沙盒写权限
  process.env.DSH_STEAM_HISTORY = join(TMP, 'price-history.json');

  mod.apply(ctx, {});
  const names = [...tools.keys()].sort();
  console.log('导出的插件名:', mod.name);
  console.log('注册的工具:', names.join(', '));
  if (names.length !== 21) throw new Error('工具数量不对，期望 21 个（v0.8.0 新增 recent/level）');

  // 1) steam_price 真跑
  const price = await tools.get('steam_price').execute({ appids: [730, 1245620] }, {});
  console.log('\n[steam_price] ok=' + price.ok);
  console.log(price.summary);
  if (!price.ok) throw new Error('steam_price 失败');
  if (price.items.length !== 2) throw new Error('steam_price 返回条数不对');

  // 2) steam_watch：无折扣时应为空
  const watch = await tools.get('steam_watch').execute({ appids: [1245620], minDiscount: 1 }, {});
  console.log('\n[steam_watch] ok=' + watch.ok + ' deals=' + watch.deals.length);
  console.log(watch.summary);
  if (watch.deals.length !== 0) throw new Error('本该没有折扣');

  // 3) steam_install：演练模式，不真的唤起 Steam
  const dry = await tools.get('steam_install').execute({ appid: 730, dryRun: true }, {});
  console.log('\n[steam_install dryRun] ok=' + dry.ok + ' launched=' + dry.launched);
  console.log(dry.summary);
  if (dry.launched !== false) throw new Error('演练模式不该真的启动');

  // 4) steam_library：无 Key 时显式 SKIP（CI 场景）；不硬要求 ok=true
  const lib = await tools.get('steam_library').execute({}, {});
  console.log('\n[steam_library] ok=' + lib.ok);
  console.log(lib.summary.slice(0, 80));
  const missingKey = !lib.ok && /API Key|DSH_STEAM_API_KEY/i.test(lib.summary ?? '');
  if (missingKey) {
    console.log('SKIP steam_library（未配置 Key）');
  } else if (!lib.ok) {
    console.log('WARN steam_library ok=false（有 Key 但仍失败，常见原因：资料未公开）');
  }

  // 5) steam_search：名字 → appid
  const search = await tools.get('steam_search').execute({ query: '影之刃', limit: 3 }, {});
  console.log('\n[steam_search] ok=' + search.ok + ' items=' + search.items.length);
  console.log(search.summary.split('\n').slice(0, 3).join('\n'));
  if (!search.ok) throw new Error('steam_search 失败');
  if (!search.items.length) throw new Error('steam_search 没搜到结果');
  if (!search.items.some((i) => i.appid === 4115450)) throw new Error('steam_search 没返回影之刃零的 appid');

  // 6) steam_download_status：纯本地读取；CI 无 Steam 时显式 SKIP，不硬要求 ok=true
  const dl = await tools.get('steam_download_status').execute({ top: 3 }, {});
  console.log('\n[steam_download_status] ok=' + dl.ok);
  if (!dl.ok) {
    console.log('SKIP steam_download_status（本机无 Steam）');
    console.log(dl.summary);
  } else {
    console.log(dl.summary.split('\n').slice(0, 6).join('\n'));
    if (typeof dl.counts.total !== 'number') throw new Error('缺少 counts.total');
    // SPEC 3.4：非下载中的条目 progressPercent 必须是 null（不能用 100 冒充）
    const badProgress = [...(dl.needsUpdate ?? []), ...(dl.topBySize ?? [])]
      .filter((x) => x.downloading !== true && x.progressPercent !== null);
    if (badProgress.length > 0) {
      throw new Error('progressPercent 语义错误：非下载中应为 null，实际有 ' + badProgress.length + ' 条不是');
    }
    console.log('progressPercent 语义：非下载中均为 null ✓');
  }

  // 7) steam_deals：今日特惠（公开接口，无需 Key）
  const deals = await tools.get('steam_deals').execute({ mode: 'specials', limit: 5 }, {});
  console.log('\n[steam_deals] ok=' + deals.ok + ' items=' + (deals.items?.length ?? 0));
  console.log(deals.summary.split('\n').slice(0, 3).join('\n'));
  if (!deals.ok) throw new Error('steam_deals 失败');
  if (!deals.items?.length) throw new Error('steam_deals 没返回条目');
  for (const d of deals.items) {
    if (typeof d.appid !== 'number') throw new Error('deals 条目缺 appid');
    if (typeof d.discountPercent !== 'number') throw new Error('deals 条目缺 discountPercent');
  }
  // specials 模式只应有打折的
  if (deals.items.some((d) => d.discountPercent <= 0)) {
    throw new Error('specials 模式返回了未打折的条目');
  }
  // 非法 mode 应优雅失败
  const badMode = await tools.get('steam_deals').execute({ mode: 'nope' }, {});
  if (badMode.ok !== false) throw new Error('非法 mode 应当 ok:false');
  console.log('非法 mode 处理：' + badMode.summary.slice(0, 40));

  // 8) steam_watch 第二次：应能读到历史（firstSample 变 false）
  const watch2 = await tools.get('steam_watch').execute({ appids: [1245620], minDiscount: 1 }, {});
  console.log('\n[steam_watch 二次] ok=' + watch2.ok + ' historySaved=' + watch2.historySaved);
  if (watch2.historySaved !== true) throw new Error('价格历史没写进去');

  // 9) steam_specs：配置要求（HTML 必须剥干净）
  const specs = await tools.get('steam_specs').execute({ appid: 4115450 }, {});
  console.log('\n[steam_specs] ok=' + specs.ok + ' name=' + (specs.name ?? ''));
  if (!specs.ok) throw new Error('steam_specs 失败');
  if (typeof specs.minimum !== 'string') throw new Error('specs.minimum 不是字符串');
  if (/<[a-z][^>]*>/i.test(specs.minimum) || /<[a-z][^>]*>/i.test(specs.recommended ?? '')) {
    throw new Error('specs 里还有 HTML 标签没剥干净');
  }
  console.log('  最低配置前 60 字：' + specs.minimum.slice(0, 60));

  // 10) steam_news：更新公告
  const news = await tools.get('steam_news').execute({ appid: 4115450, count: 3, maxLength: 120 }, {});
  console.log('\n[steam_news] ok=' + news.ok + ' items=' + (news.items?.length ?? 0));
  if (!news.ok) throw new Error('steam_news 失败');
  if (!news.items?.length) throw new Error('steam_news 没返回条目');
  const n0 = news.items[0];
  if (!n0.gid || !n0.title || !/^\d{4}-\d{2}-\d{2}/.test(n0.date)) throw new Error('news 条目字段不完整');
  if (!/^https:\/\/store\.steampowered\.com\/news\/app\/4115450\/view\//.test(n0.url)) throw new Error('news.url 格式不对');
  console.log('  最新：' + n0.date.slice(0, 10) + ' ' + n0.title.slice(0, 40));

  // 11) steam_price_history：本地历史（前面 steam_watch 已经写过 1245620）
  const hist = await tools.get('steam_price_history').execute({ appid: 1245620 }, {});
  console.log('\n[steam_price_history] ok=' + hist.ok + ' samples=' + hist.samples);
  if (!hist.ok) throw new Error('steam_price_history 失败：' + hist.summary);
  if (!(hist.samples >= 1)) throw new Error('price_history 样本数不对');
  if (typeof hist.lowestText !== 'string' || !hist.lowestText) throw new Error('price_history 缺 lowestText');
  console.log('  史低：' + hist.lowestText + '（' + hist.lowestDate + '），样本 ' + hist.samples + ' 条');

  // 12) steam_players：当前在线人数（免 Key）
  const players = await tools.get('steam_players').execute({ appid: 4115450 }, {});
  console.log('\n[steam_players] ok=' + players.ok + ' count=' + players.playerCount);
  if (!players.ok) throw new Error('steam_players 失败：' + players.summary);
  if (typeof players.playerCount !== 'number' || players.playerCount <= 0) throw new Error('playerCount 不合理');

  // 13) steam_achievements_global：全球成就完成率（免 Key）
  const ga = await tools.get('steam_achievements_global').execute({ appid: 4115450, limit: 5 }, {});
  console.log('\n[steam_achievements_global] ok=' + ga.ok + ' items=' + (ga.items?.length ?? 0));
  if (!ga.ok) throw new Error('steam_achievements_global 失败');
  if (!ga.items?.length) throw new Error('全球成就为空');
  if (typeof ga.items[0].percent !== 'number') throw new Error('percent 不是数字');
  if (ga.items.some((x, i, arr) => i > 0 && x.percent < arr[i-1].percent)) throw new Error('未按 percent 升序');
  console.log('  最难：' + ga.items[0].name + ' ' + ga.items[0].percent + '%');

  // 14) steam_open：白名单 + dryRun
  const open1 = await tools.get('steam_open').execute({ target: '4115450', dryRun: true }, {});
  console.log('\n[steam_open] ok=' + open1.ok + ' uri=' + open1.uri + ' launched=' + open1.launched);
  if (!open1.ok) throw new Error('steam_open 失败');
  if (open1.launched !== false) throw new Error('dryRun 不该真的唤起');
  if (!/^steam:\/\/store\/4115450$/.test(open1.uri)) throw new Error('store URI 不对');
  const open2 = await tools.get('steam_open').execute({ target: 'run:730', dryRun: true }, {});
  if (!/^steam:\/\/run\/730$/.test(open2.uri)) throw new Error('run URI 不对');
  const bad = await tools.get('steam_open').execute({ target: 'url:https://evil.example.com/x', dryRun: true }, {});
  if (bad.ok !== false) throw new Error('非白名单域名必须拒绝');
  console.log('  非白名单被拒：' + bad.summary.slice(0, 40));

  // 15) friends/achievements/wishlist：无 Key → 指引；有 Key 但无 steamid → 也须可读失败（不抛错）
  for (const name of ['steam_friends', 'steam_achievements', 'steam_wishlist']) {
    const r = await tools.get(name).execute(name === 'steam_achievements' ? { appid: 730 } : {}, {});
    console.log('\n[' + name + '] ok=' + r.ok + ' :: ' + String(r.summary).slice(0, 50));
    if (r.ok) {
      // 有 Key 且能解析到 steamid 时允许成功
      continue;
    }
    if (!/Key|DSH_STEAM_API_KEY|steamid|vanity/i.test(String(r.summary))) {
      throw new Error(name + ' 失败时应给出 Key 或 steamid 指引');
    }
  }

  // 16) steam_media：截图/预告片
  const media = await tools.get('steam_media').execute({ appid: 4115450, kind: 'all', limit: 5 }, {});
  console.log('\n[steam_media] ok=' + media.ok + ' shots=' + (media.screenshots?.length ?? 0) + ' movies=' + (media.movies?.length ?? 0));
  if (!media.ok) throw new Error('steam_media 失败');
  if (!media.screenshots?.length) throw new Error('media 无截图');
  if (!/^https?:/.test(media.screenshots[0].fullUrl)) throw new Error('截图 URL 不合法');

  // 17) steam_dlc：DLC 列表与价格（影之刃零有 1 个 DLC）
  const dlc = await tools.get('steam_dlc').execute({ appid: 4115450, limit: 5 }, {});
  console.log('\n[steam_dlc] ok=' + dlc.ok + ' total=' + dlc.total + ' items=' + (dlc.items?.length ?? 0));
  if (!dlc.ok) throw new Error('steam_dlc 失败');
  if (typeof dlc.total !== 'number') throw new Error('dlc 缺 total');
  if (dlc.items.some((x) => typeof x.appid !== 'number')) throw new Error('dlc 条目缺 appid');

  // 18) steam_achievement_schema：无 Key 降级；有 Key 验形状
  const hasKey = Boolean(process.env.DSH_STEAM_API_KEY);
  const schema = await tools.get('steam_achievement_schema').execute({ appid: 4115450 }, {});
  console.log('\n[steam_achievement_schema] ok=' + schema.ok + ' :: ' + String(schema.summary).slice(0, 40));
  if (hasKey) {
    if (!schema.ok) throw new Error('有 Key 时 steam_achievement_schema 应成功：' + schema.summary);
    if (!Array.isArray(schema.achievements) || schema.achievements.length === 0) {
      throw new Error('schema.achievements 应非空');
    }
  } else {
    if (schema.ok !== false) throw new Error('无 Key 时应 ok:false');
    if (!/Key|DSH_STEAM_API_KEY/i.test(String(schema.summary))) throw new Error('缺少 Key 指引');
  }

  // 19/20) steam_recent + steam_level：有 Key 时验形状，无 Key 时验优雅降级
  console.log('\n--- Key 工具（hasKey=' + hasKey + '）---');
  for (const name of ['steam_recent', 'steam_level']) {
    const r = await tools.get(name).execute({}, {});
    console.log('[' + name + '] ok=' + r.ok + ' :: ' + String(r.summary).split('\n')[0].slice(0, 60));
    if (r.ok) {
      if (name === 'steam_recent' && !Array.isArray(r.items)) throw new Error('recent 缺 items');
      if (name === 'steam_level' && typeof r.level !== 'number') throw new Error('level 不是数字');
    } else {
      if (!/Key|DSH_STEAM_API_KEY/i.test(String(r.summary))) throw new Error(name + ' 缺少 Key 指引');
    }
  }

  await rm(TMP, { recursive: true, force: true });
  console.log('\n✅ 自检通过');
}

main().catch(async (err) => {
  console.error('\n❌ 自检失败:', err?.message ?? err);
  try { await rm(TMP, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
