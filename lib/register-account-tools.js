/**
 * 需 Key 的账号工具：friends / achievements / wishlist / achievement_schema
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { fetchPrices, resolveVanity, describePrice } from './steam-api.js';
import {
  fetchFriends,
  fetchPlayerAchievements,
  fetchWishlistAppids,
  fetchAchievementSchema,
} from './steam-account-api.js';
import { renderResult, looseOutput, safe } from './tool-helpers.js';

const NO_KEY =
  '缺少 Steam Web API Key。到 https://steamcommunity.com/dev/apikey 申请后，填入插件配置的 apiKey（或环境变量 DSH_STEAM_API_KEY）。';

async function resolveSteamid(apiKey, args, cfg) {
  let steamid = args.steamid || cfg.steamId || '';
  if (!steamid && args.vanity) {
    steamid = (await resolveVanity(apiKey, args.vanity)) || '';
    if (!steamid) {
      return { ok: false, summary: `找不到自定义 URL「${args.vanity}」，请确认拼写或改用 SteamID64。` };
    }
  }
  if (!steamid) {
    return {
      ok: false,
      summary: '需要 steamid 或 vanity（或在插件配置里预置 steamId）。',
    };
  }
  return { ok: true, steamid };
}

export function registerAccountTools(register, cfg) {
  register(
    defineTool({
      name: 'steam_friends',
      description:
        '读取好友列表与在线状态（需 Web API Key；好友列表须对你可见）。可用 steamid / vanity。',
      parameters: {
        steamid: { type: 'string', description: 'SteamID64，可省略' },
        vanity: { type: 'string', description: '自定义 URL 名' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 45000,
      execute: safe(async (args) => {
        const apiKey = cfg.apiKey || process.env.DSH_STEAM_API_KEY || '';
        if (!apiKey) return { ok: false, summary: NO_KEY };
        const id = await resolveSteamid(apiKey, args, cfg);
        if (!id.ok) return id;
        const { count, friends } = await fetchFriends(apiKey, id.steamid);
        return {
          ok: true,
          count,
          friends,
          summary:
            count === 0
              ? '好友列表为空，或隐私设置不允许读取。'
              : `共 ${count} 位好友：\n` +
                friends
                  .slice(0, 20)
                  .map((f) => `· ${f.personaName}${f.inGame ? `（在玩 ${f.inGame}）` : ''}`)
                  .join('\n'),
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_achievements',
      description:
        '查询某账号在指定游戏的成就进度（需 Web API Key；未拥有该游戏会失败）。',
      parameters: {
        appid: { type: 'integer', required: true, description: '游戏 appid' },
        steamid: { type: 'string', description: 'SteamID64，可省略' },
        vanity: { type: 'string', description: '自定义 URL 名' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 45000,
      execute: safe(async (args) => {
        const apiKey = cfg.apiKey || process.env.DSH_STEAM_API_KEY || '';
        if (!apiKey) return { ok: false, summary: NO_KEY };
        const id = await resolveSteamid(apiKey, args, cfg);
        if (!id.ok) return id;
        const appid = Number(args.appid);
        if (!Number.isInteger(appid) || appid <= 0) {
          return { ok: false, summary: `appid 无效：${args.appid}` };
        }
        const res = await fetchPlayerAchievements(apiKey, id.steamid, appid);
        if (!res.ok) {
          return {
            ok: false,
            appid,
            summary: `无法读取成就：${res.error}。确认已拥有该游戏且成就资料公开。`,
          };
        }
        return {
          ok: true,
          appid: res.appid,
          total: res.total,
          unlocked: res.unlocked,
          items: res.items,
          summary: `${res.gameName ?? appid}：已解锁 ${res.unlocked}/${res.total}`,
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_wishlist',
      description:
        '读取愿望单并用商店接口补名称与价格（最多 20 条）。需 Web API Key。',
      parameters: {
        steamid: { type: 'string', description: 'SteamID64，可省略' },
        vanity: { type: 'string', description: '自定义 URL 名' },
        cc: { type: 'string', description: '商店区域，默认 cn' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 60000,
      execute: safe(async (args) => {
        const apiKey = cfg.apiKey || process.env.DSH_STEAM_API_KEY || '';
        if (!apiKey) return { ok: false, summary: NO_KEY };
        const id = await resolveSteamid(apiKey, args, cfg);
        if (!id.ok) return id;
        const cc = (args.cc || cfg.cc || 'cn').toLowerCase();
        const { appids } = await fetchWishlistAppids(apiKey, id.steamid);
        if (appids.length === 0) {
          return {
            ok: false,
            count: 0,
            appids: [],
            items: [],
            summary: '愿望单为空，或隐私设置为不公开。到个人资料 → 隐私设置中开放愿望单后再试。',
          };
        }
        const sample = appids.slice(0, 20);
        const priced = await fetchPrices(sample, { cc });
        return {
          ok: true,
          count: appids.length,
          appids,
          items: priced,
          summary: [
            `愿望单共 ${appids.length} 个，已补价前 ${priced.length} 个（区服 ${cc}）：`,
            ...priced.map((p) => `· ${describePrice(p)}`),
          ].join('\n'),
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_achievement_schema',
      description:
        '拉取成就 schema（内部名 → 中文显示名/描述/图标）。需 Web API Key；未拥有游戏也可查。',
      parameters: {
        appid: { type: 'integer', required: true, description: 'Steam appid' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 30000,
      execute: safe(async (args) => {
        const apiKey = cfg.apiKey || process.env.DSH_STEAM_API_KEY || '';
        if (!apiKey) return { ok: false, summary: NO_KEY };
        const appid = Number(args.appid);
        if (!Number.isInteger(appid) || appid <= 0) {
          return { ok: false, summary: `appid 无效：${args.appid}` };
        }
        const res = await fetchAchievementSchema(apiKey, appid);
        if (!res.ok) {
          return {
            ok: false,
            appid: res.appid,
            achievements: [],
            summary: res.error,
          };
        }
        return {
          ok: true,
          appid: res.appid,
          gameName: res.gameName,
          achievements: res.achievements,
          summary:
            res.achievements.length === 0
              ? `${res.gameName ?? appid}：无成就 schema。`
              : `${res.gameName ?? appid}：共 ${res.achievements.length} 个成就定义（可用于把 ACH_xxx 映射成中文名）。`,
        };
      }),
    }),
  );
}
