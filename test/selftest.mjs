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
  if (names.length !== 6) throw new Error('工具数量不对，期望 6 个');

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

  // 4) steam_library 无 Key 时给出可读提示而不是抛错
  const lib = await tools.get('steam_library').execute({}, {});
  console.log('\n[steam_library 无 Key] ok=' + lib.ok);
  console.log(lib.summary.slice(0, 80));

  // 5) steam_search：名字 → appid
  const search = await tools.get('steam_search').execute({ query: '影之刃', limit: 3 }, {});
  console.log('\n[steam_search] ok=' + search.ok + ' items=' + search.items.length);
  console.log(search.summary.split('\n').slice(0, 3).join('\n'));
  if (!search.ok) throw new Error('steam_search 失败');
  if (!search.items.length) throw new Error('steam_search 没搜到结果');
  if (!search.items.some((i) => i.appid === 4115450)) throw new Error('steam_search 没返回影之刃零的 appid');

  // 6) steam_download_status：纯本地读取
  const dl = await tools.get('steam_download_status').execute({ top: 3 }, {});
  console.log('\n[steam_download_status] ok=' + dl.ok);
  if (!dl.ok) {
    console.log(dl.summary);
  } else {
    console.log(dl.summary.split('\n').slice(0, 6).join('\n'));
    if (typeof dl.counts.total !== 'number') throw new Error('缺少 counts.total');
  }

  // 7) steam_watch 第二次：应能读到历史（firstSample 变 false）
  const watch2 = await tools.get('steam_watch').execute({ appids: [1245620], minDiscount: 1 }, {});
  console.log('\n[steam_watch 二次] ok=' + watch2.ok + ' historySaved=' + watch2.historySaved);
  if (watch2.historySaved !== true) throw new Error('价格历史没写进去');

  await rm(TMP, { recursive: true, force: true });
  console.log('\n✅ 自检通过');
}

main().catch(async (err) => {
  console.error('\n❌ 自检失败:', err?.message ?? err);
  try { await rm(TMP, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
