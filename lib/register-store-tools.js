/**
 * 商店侧工具：steam_price / steam_search / steam_watch
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { fetchPrices, searchStore, describePrice } from './steam-api.js';
import { loadStore, saveStore, recordPrice, fmtCents } from './price-history.js';
import { renderResult, looseOutput, appidsParam, safe } from './tool-helpers.js';

export function registerStoreTools(register, cfg) {
  register(
    defineTool({
      name: 'steam_price',
      description:
        '查询 Steam 游戏的价格与折扣（公开商店接口，无需 API Key）。支持一次查多个 appid。区域默认国区（cc=cn）。',
      parameters: {
        appids: appidsParam,
        cc: { type: 'string', description: '商店区域代码，默认 cn；例如 us、hk、jp' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 60000,
      execute: safe(async (args) => {
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const items = await fetchPrices(args.appids, { cc });
        if (items.length === 0) {
          return {
            ok: false,
            cc,
            items: [],
            summary:
              'appids 里没有有效的正整数。请传入例如 [730, 1245620]；可用 steam_search 先查 appid。',
          };
        }
        const lines = items.map(describePrice);
        const deals = items.filter((i) => i.ok && i.discountPercent > 0);
        return {
          ok: items.every((i) => i.ok),
          cc,
          items,
          summary: [
            `查询 ${items.length} 个 appid（区服 ${cc}），其中 ${deals.length} 个正在打折：`,
            ...lines.map((l) => `· ${l}`),
          ].join('\n'),
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_search',
      description:
        '按名字搜索 Steam 商店，把游戏名换成 appid。公开接口，无需 API Key。适合查价/安装前定位 appid。',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description: '搜索关键词，中英文都行，例如「影之刃」「Elden Ring」',
        },
        limit: { type: 'integer', description: '返回条数，默认 8，最大 50' },
        cc: { type: 'string', description: '商店区域，默认 cn' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 30000,
      execute: safe(async (args) => {
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const res = await searchStore(args.query, { cc, limit: args.limit ?? 8 });
        if (!res.ok) {
          return { ok: false, cc: res.cc ?? cc, total: 0, items: [], summary: res.error };
        }
        if (res.items.length === 0) {
          return {
            ok: true,
            cc,
            total: 0,
            items: [],
            summary: `没搜到「${args.query}」（区服 ${cc}）。换个关键词，或者直接用 appid。`,
          };
        }
        return {
          ok: true,
          cc,
          total: res.total,
          items: res.items,
          summary: [
            `搜到 ${res.total} 个结果，前 ${res.items.length} 个：`,
            ...res.items.map((it) => {
              const price =
                it.finalCents === null
                  ? '无价格'
                  : it.discountPercent > 0
                    ? `${fmtCents(it.finalCents, it.currency)}（-${it.discountPercent}%）`
                    : fmtCents(it.finalCents, it.currency);
              return `· ${it.name}  appid=${it.appid}  ${price}`;
            }),
          ].join('\n'),
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_watch',
      description:
        '折扣监控：批量查价后只返回折扣达到阈值的游戏，适合定时任务每天调用。无折扣时 ok=true 且 deals 为空。',
      parameters: {
        appids: appidsParam,
        minDiscount: { type: 'integer', description: '只看折扣 ≥ 该百分比的，默认 1' },
        cc: { type: 'string', description: '商店区域，默认 cn' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 60000,
      execute: safe(async (args) => {
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const minDiscount = Math.max(1, Math.min(100, Number(args.minDiscount) || 1));
        const items = await fetchPrices(args.appids, { cc });
        if (items.length === 0) {
          return {
            ok: false,
            cc,
            checked: 0,
            deals: [],
            historySaved: false,
            summary: 'appids 无效。请传入正整数数组，例如 [730, 1245620]。',
          };
        }

        // 历史写入失败只降级 historySaved，不让整工具失败
        const store = loadStore();
        const annotated = items.map((it) => {
          if (!it.ok) return it;
          const rec = recordPrice(store, it);
          const hist = store.apps[String(it.appid)];
          return {
            ...it,
            lowestCents: hist?.lowestCents ?? null,
            lowestText: fmtCents(hist?.lowestCents, it.currency ?? 'CNY'),
            isNewLow: rec.isNewLow,
            firstSample: rec.isFirstSample,
          };
        });
        const saved = saveStore(store);
        const histNote = saved
          ? '（价格已记入历史）'
          : '（价格历史写入失败，不影响本次结果；检查 DSH_STEAM_HISTORY 路径权限）';

        const deals = annotated
          .filter((i) => i.ok && i.discountPercent >= minDiscount)
          .sort((a, b) => b.discountPercent - a.discountPercent);

        if (deals.length === 0) {
          return {
            ok: true,
            cc,
            checked: annotated.length,
            deals: [],
            historySaved: saved,
            summary: `检查了 ${annotated.length} 个游戏（区服 ${cc}），没有达到 ${minDiscount}% 的折扣。${histNote}`,
          };
        }

        return {
          ok: true,
          cc,
          checked: annotated.length,
          deals,
          historySaved: saved,
          summary: [
            `发现 ${deals.length} 个达到 ${minDiscount}% 的折扣（区服 ${cc}）：`,
            ...deals.map((d) => {
              const tags = [
                d.isNewLow ? '🔥 历史新低' : '',
                d.firstSample ? '首次记录' : `史低 ${d.lowestText}`,
              ]
                .filter(Boolean)
                .join(' · ');
              return `· ${describePrice(d)} — ${tags} — ${d.storeUrl}`;
            }),
          ].join('\n'),
        };
      }),
    }),
  );
}
