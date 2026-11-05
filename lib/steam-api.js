/**
 * 网络层：Steam 商店 / Web API 访问。
 *
 * 不依赖 DSH 运行时，便于用普通 node 直接测。
 * 失败一律变成可读 Error（或 per-appid 的 {ok:false}），由工具层决定如何呈现。
 *
 * 数据源：
 *  - store.steampowered.com —— 公开，无需 Key（查价 / 搜索）
 *  - api.steampowered.com —— 需要个人 API Key（库 / 时长 / vanity）
 */

const STORE_BASE = 'https://store.steampowered.com/api/appdetails';
const STORE_SEARCH = 'https://store.steampowered.com/api/storesearch/';
const WEBAPI_BASE = 'https://api.steampowered.com';

/** 单次请求上限；工具级超时由 defineTool.timeoutMs 另行约束。 */
const DEFAULT_TIMEOUT_MS = 15000;

const UA = 'dsh-steam/0.3 (+https://github.com/)';

/**
 * 带超时的 JSON GET。
 * 自定义 UA：商店接口对默认 Node UA 经常返回空 body。
 */
async function getJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, label = 'request' } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason =
      err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? `超时 ${timeoutMs}ms（网络慢或被墙，可稍后重试）`
        : (err?.message ?? String(err));
    throw new Error(`${label} 请求失败：${reason}`);
  }
  if (!res.ok) {
    throw new Error(
      `${label} 返回 HTTP ${res.status}（商店限流时常为 429，稍等再试）`,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`${label} 返回的不是 JSON（可能被中间页劫持）`);
  }
}

/** 分片并发，避免一次打太多请求被商店限流。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const n = Math.min(limit, items.length);
  if (n <= 0) return out;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** 规范化 appid 列表：去重、只留正整数。 */
export function normalizeAppids(appids) {
  const raw = Array.isArray(appids) ? appids : [];
  return [...new Set(raw.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];
}

/**
 * 查一个或多个 appid 的价格与折扣。
 * 单个失败不影响其它：每条结果自带 ok / error。
 * 没有任何合法 appid 时返回空数组（不抛），由工具层给出说明。
 */
export async function fetchPrices(appids, opts = {}) {
  const cc = (opts.cc ?? 'cn').toLowerCase();
  const lang = opts.lang ?? 'schinese';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ids = normalizeAppids(appids);
  if (ids.length === 0) return [];

  return mapLimit(ids, 4, async (appid) => {
    const url = `${STORE_BASE}?appids=${appid}&cc=${encodeURIComponent(cc)}&l=${encodeURIComponent(lang)}`;
    try {
      const json = await getJson(url, { timeoutMs, label: `appdetails(${appid})` });
      const entry = json?.[String(appid)];
      if (!entry?.success || !entry.data) {
        return {
          appid,
          ok: false,
          error: '商店没有返回该 appid（可能区服不可见、下架，或 appid 写错）',
        };
      }
      const d = entry.data;
      const p = d.price_overview;
      return {
        appid,
        ok: true,
        name: d.name,
        isFree: Boolean(d.is_free),
        currency: p?.currency ?? null,
        // Steam 价格单位是「分」；同时保留 final_formatted 给人读
        finalCents: p?.final ?? null,
        initialCents: p?.initial ?? null,
        finalText: p?.final_formatted ?? null,
        initialText: p?.initial_formatted ?? null,
        discountPercent: p?.discount_percent ?? 0,
        releaseDate: d.release_date?.date ?? null,
        developers: d.developers ?? [],
        platforms: d.platforms ?? {},
        storeUrl: `https://store.steampowered.com/app/${appid}/`,
      };
    } catch (err) {
      return { appid, ok: false, error: err?.message ?? String(err) };
    }
  });
}

/** vanity 自定义 URL 名 → SteamID64；找不到返回 null。 */
export async function resolveVanity(apiKey, vanity) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const url =
    `${WEBAPI_BASE}/ISteamUser/ResolveVanityURL/v1/` +
    `?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`;
  const json = await getJson(url, { label: 'ResolveVanityURL' });
  const r = json?.response;
  if (r?.success !== 1) return null;
  return r.steamid ?? null;
}

/** 公开资料摘要（昵称、在线状态、当前游戏）。 */
export async function fetchPlayerSummary(apiKey, steamid) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const url =
    `${WEBAPI_BASE}/ISteamUser/GetPlayerSummaries/v2/` +
    `?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamid)}`;
  const json = await getJson(url, { label: 'GetPlayerSummaries' });
  const p = json?.response?.players?.[0];
  if (!p) return null;
  return {
    steamid: p.steamid,
    personaName: p.personaname,
    profileUrl: p.profileurl,
    avatar: p.avatarfull,
    state: p.personastate,
    inGame: p.gameextrainfo ?? null,
    lastLogoff: p.lastlogoff ?? null,
    createdAt: p.timecreated ?? null,
  };
}

/**
 * 拥有的游戏与游玩时长。
 * 资料「游戏详情」非公开时 Steam 返回空列表，调用方应提示用户改隐私。
 */
export async function fetchOwnedGames(apiKey, steamid, opts = {}) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const includeAppInfo = opts.includeAppInfo === false ? 0 : 1;
  const url =
    `${WEBAPI_BASE}/IPlayerService/GetOwnedGames/v1/` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamid)}` +
    `&include_appinfo=${includeAppInfo}&include_played_free_games=1`;
  const json = await getJson(url, { label: 'GetOwnedGames' });
  const r = json?.response ?? {};
  const games = (r.games ?? []).map((g) => ({
    appid: g.appid,
    name: g.name ?? `appid ${g.appid}`,
    playtimeMinutes: g.playtime_forever ?? 0,
    playtimeTwoWeeksMinutes: g.playtime_2weeks ?? 0,
    lastPlayed: g.rtime_last_played ?? 0,
  }));
  games.sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);
  return {
    gameCount: r.game_count ?? games.length,
    totalPlaytimeMinutes: games.reduce((sum, g) => sum + g.playtimeMinutes, 0),
    games,
  };
}

/**
 * 商店搜索：游戏名 → appid。
 * 空关键词返回 { ok:false, items:[], error }，不抛错（契约要求工具层优雅降级）。
 */
export async function searchStore(term, opts = {}) {
  const q = String(term ?? '').trim();
  if (!q) {
    return {
      ok: false,
      total: 0,
      cc: (opts.cc ?? 'cn').toLowerCase(),
      items: [],
      error: '搜索关键词为空。请输入游戏名，例如「影之刃」或「Elden Ring」。',
    };
  }
  const cc = (opts.cc ?? 'cn').toLowerCase();
  const lang = opts.lang ?? 'schinese';
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 10));

  const url =
    `${STORE_SEARCH}?term=${encodeURIComponent(q)}` +
    `&cc=${encodeURIComponent(cc)}&l=${encodeURIComponent(lang)}`;
  const json = await getJson(url, { label: 'storesearch' });

  const items = (json?.items ?? []).slice(0, limit).map((it) => {
    const p = it.price;
    const hasPrice = p && typeof p.final === 'number' && typeof p.initial === 'number';
    return {
      appid: it.id,
      name: it.name,
      type: it.type,
      currency: p?.currency ?? null,
      finalCents: typeof p?.final === 'number' ? p.final : null,
      initialCents: typeof p?.initial === 'number' ? p.initial : null,
      discountPercent:
        hasPrice && p.initial > 0 ? Math.round((1 - p.final / p.initial) * 100) : 0,
      metascore: it.metascore || null,
      storeUrl: `https://store.steampowered.com/app/${it.id}/`,
    };
  });

  return { ok: true, total: json?.total ?? items.length, cc, items };
}

/** 分钟 →「12 小时 34 分」。 */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} 分钟`;
  if (m === 0) return `${h} 小时`;
  return `${h} 小时 ${m} 分`;
}

/** 单条查价结果 → 一行中文。 */
export function describePrice(item) {
  if (!item?.ok) {
    return `appid ${item?.appid ?? '?'}：查询失败（${item?.error ?? '未知错误'}）`;
  }
  if (item.isFree) return `${item.name}：免费`;
  if (item.discountPercent > 0) {
    return `${item.name}：${item.finalText}（原价 ${item.initialText}，-${item.discountPercent}%）`;
  }
  return `${item.name}：${item.finalText ?? '无价格信息'}（无折扣）`;
}
