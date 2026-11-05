/**
 * 媒体 / DLC：steam_media / steam_dlc（免 Key）
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { fetchPrices } from './steam-api.js';
import { fetchAppMedia, fetchAppDlcIds } from './steam-media-api.js';
import { renderResult, looseOutput, safe } from './tool-helpers.js';

export function registerMediaTools(register, cfg) {
  register(
    defineTool({
      name: 'steam_media',
      description:
        '查询游戏截图与预告片 URL（公开 appdetails，无需 Key）。只返回链接，不下载文件。',
      parameters: {
        appid: { type: 'integer', required: true, description: 'Steam appid' },
        kind: {
          type: 'string',
          description: 'screenshots | movies | all（默认 all）',
        },
        limit: { type: 'integer', description: '每类最多条数，默认 10，上限 30' },
        cc: { type: 'string', description: '商店区域，默认 cn' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 30000,
      execute: safe(async (args) => {
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const res = await fetchAppMedia(args.appid, {
          kind: args.kind ?? 'all',
          limit: args.limit ?? 10,
          cc,
        });
        if (!res.ok) {
          return {
            ok: false,
            appid: res.appid,
            screenshots: [],
            movies: [],
            summary: res.error,
          };
        }
        return {
          ok: true,
          appid: res.appid,
          screenshots: res.screenshots,
          movies: res.movies,
          summary: `${res.name ?? res.appid}：截图 ${res.screenshots.length} 张，预告片 ${res.movies.length} 个（仅 URL，未下载）。`,
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_dlc',
      description:
        '列出游戏 DLC 并查前 limit 条价格（公开接口，无需 Key）。total 为 DLC 总数。',
      parameters: {
        appid: { type: 'integer', required: true, description: '主游戏 Steam appid' },
        limit: { type: 'integer', description: '最多查价条数，默认 10，上限 30' },
        cc: { type: 'string', description: '商店区域，默认 cn' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 60000,
      execute: safe(async (args) => {
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const limit = Math.max(1, Math.min(30, Number(args.limit) || 10));
        const base = await fetchAppDlcIds(args.appid, { cc });
        if (!base.ok) {
          return { ok: false, appid: base.appid, total: 0, items: [], summary: base.error };
        }
        const total = base.dlcIds.length;
        if (total === 0) {
          return {
            ok: true,
            appid: base.appid,
            total: 0,
            items: [],
            summary: `${base.name ?? base.appid} 没有列出 DLC（或该区服不可见）。`,
          };
        }
        const sample = base.dlcIds.slice(0, limit);
        const priced = await fetchPrices(sample, { cc });
        const items = priced.map((p) => ({
          appid: p.appid,
          name: p.ok ? p.name : `appid ${p.appid}`,
          finalText: p.ok ? (p.finalText ?? null) : null,
          discountPercent: p.ok ? (p.discountPercent ?? 0) : 0,
          storeUrl: p.storeUrl ?? `https://store.steampowered.com/app/${p.appid}/`,
          ok: p.ok,
          error: p.ok ? undefined : p.error,
        }));
        return {
          ok: true,
          appid: base.appid,
          total,
          items,
          summary: [
            `${base.name ?? base.appid}：共 ${total} 个 DLC，已查价 ${items.length} 个（区服 ${cc}）：`,
            ...items.map((it) =>
              it.finalText
                ? `· ${it.name} ${it.finalText}` +
                  (it.discountPercent > 0 ? `（-${it.discountPercent}%）` : '')
                : `· ${it.name}（无价格）`,
            ),
          ].join('\n'),
        };
      }),
    }),
  );
}
