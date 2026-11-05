/**
 * 资讯侧工具：steam_specs / steam_news
 * 从 register-store-tools 拆出，避免单文件超过 400 行。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { fetchAppSpecs, fetchAppNews } from './steam-api.js';
import { renderResult, looseOutput, safe } from './tool-helpers.js';

export function registerInfoTools(register, cfg) {
  register(
    defineTool({
      name: 'steam_specs',
      description:
        '查询游戏 PC 最低/推荐配置（公开 appdetails 接口，无需 API Key）。HTML 已剥成纯文本，便于判断本机能否带得动。',
      parameters: {
        appid: { type: 'integer', required: true, description: 'Steam appid' },
        cc: { type: 'string', description: '商店区域，默认 cn' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 30000,
      execute: safe(async (args) => {
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const res = await fetchAppSpecs(args.appid, { cc });
        if (!res.ok) {
          return {
            ok: false,
            appid: res.appid,
            summary: res.error,
          };
        }
        const note = res.empty
          ? '该游戏未提供配置要求（商店 pc_requirements 为空）。'
          : '';
        return {
          ok: true,
          appid: res.appid,
          name: res.name,
          minimum: res.minimum,
          recommended: res.recommended,
          platforms: res.platforms,
          summary: [
            `${res.name}（appid ${res.appid}）系统配置：`,
            note || [
              res.minimum ? `最低：${res.minimum}` : '最低：未提供',
              res.recommended ? `推荐：${res.recommended}` : '推荐：未提供',
            ].join('\n'),
          ]
            .filter(Boolean)
            .join('\n'),
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_news',
      description:
        '拉取游戏更新公告 / 补丁说明（ISteamNews 公开接口，无需 API Key）。feedname 可能是第三方媒体，原样返回。',
      parameters: {
        appid: { type: 'integer', required: true, description: 'Steam appid' },
        count: { type: 'integer', description: '条数，默认 5，最大 20' },
        maxLength: { type: 'integer', description: '正文摘要最大长度，默认 200，最大 1000' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 30000,
      execute: safe(async (args) => {
        const res = await fetchAppNews(args.appid, {
          count: args.count ?? 5,
          maxLength: args.maxLength ?? 200,
        });
        if (!res.ok) {
          return {
            ok: false,
            appid: res.appid,
            items: [],
            summary: res.error,
          };
        }
        if (res.items.length === 0) {
          return {
            ok: true,
            appid: res.appid,
            items: [],
            summary: `appid ${res.appid} 暂无新闻。可能刚上架或该游戏不发公告。`,
          };
        }
        return {
          ok: true,
          appid: res.appid,
          items: res.items,
          summary: [
            `appid ${res.appid} 最近 ${res.items.length} 条新闻：`,
            ...res.items.map(
              (n) => `· ${n.date.slice(0, 10)} ${n.title}（${n.feedname || '未知来源'}）`,
            ),
          ].join('\n'),
        };
      }),
    }),
  );
}
