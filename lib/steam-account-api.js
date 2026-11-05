/**
 * 需 Key 的账号接口：好友 / 个人成就 / 愿望单。
 */

const WEBAPI_BASE = 'https://api.steampowered.com';
const UA = 'dsh-steam/0.8 (+https://github.com/)';
const DEFAULT_TIMEOUT_MS = 15000;

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
        ? `超时 ${timeoutMs}ms`
        : (err?.message ?? String(err));
    throw new Error(`${label} 请求失败：${reason}`);
  }
  if (!res.ok) throw new Error(`${label} 返回 HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${label} 返回的不是 JSON`);
  }
}

/** 好友列表 + 摘要（GetFriendList + GetPlayerSummaries）。 */
export async function fetchFriends(apiKey, steamid) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const listUrl =
    `${WEBAPI_BASE}/ISteamUser/GetFriendList/v1/` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamid)}&relationship=friend`;
  const listJson = await getJson(listUrl, { label: 'GetFriendList' });
  const friendIds = (listJson?.friendslist?.friends ?? []).map((f) => f.steamid).filter(Boolean);
  if (friendIds.length === 0) return { count: 0, friends: [] };

  // Summaries 一次最多约 100 个
  const batch = friendIds.slice(0, 100);
  const sumUrl =
    `${WEBAPI_BASE}/ISteamUser/GetPlayerSummaries/v2/` +
    `?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(batch.join(','))}`;
  const sumJson = await getJson(sumUrl, { label: 'GetPlayerSummaries(friends)' });
  const byId = new Map(
    (sumJson?.response?.players ?? []).map((p) => [
      p.steamid,
      {
        steamid: p.steamid,
        personaName: p.personaname,
        state: p.personastate,
        inGame: p.gameextrainfo ?? null,
      },
    ]),
  );
  const friends = batch.map(
    (id) => byId.get(id) ?? { steamid: id, personaName: id, state: 0, inGame: null },
  );
  return { count: friends.length, friends };
}

/** 个人成就（GetPlayerAchievements，l=schinese 带显示名）。 */
export async function fetchPlayerAchievements(apiKey, steamid, appid) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const id = Number(appid);
  const url =
    `${WEBAPI_BASE}/ISteamUserStats/GetPlayerAchievements/v1/` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamid)}` +
    `&appid=${id}&l=schinese`;
  const json = await getJson(url, { label: `GetPlayerAchievements(${id})` });
  const ps = json?.playerstats;
  if (!ps || ps.success === false) {
    const err = ps?.error || '未拥有该游戏，或成就未公开 / 游戏无成就系统';
    return { ok: false, appid: id, error: err };
  }
  const items = (ps.achievements ?? []).map((a) => ({
    apiname: a.apiname,
    name: a.name ?? a.apiname,
    achieved: a.achieved === 1,
    unlockTime: a.achieved === 1 && a.unlocktime
      ? new Date(a.unlocktime * 1000).toISOString()
      : null,
  }));
  const unlocked = items.filter((i) => i.achieved).length;
  return {
    ok: true,
    appid: id,
    gameName: ps.gameName ?? null,
    total: items.length,
    unlocked,
    items,
  };
}

/**
 * 成就 schema（内部名 → 中文显示名）。
 * 未拥有游戏也能查；无成就时 achievements 为空数组。
 */
export async function fetchAchievementSchema(apiKey, appid) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, appid, achievements: [], error: `appid 无效：${appid}` };
  }
  const url =
    `${WEBAPI_BASE}/ISteamUserStats/GetSchemaForGame/v2/` +
    `?key=${encodeURIComponent(apiKey)}&appid=${id}&l=schinese`;
  const json = await getJson(url, { label: `GetSchemaForGame(${id})` });
  const game = json?.game;
  if (!game) {
    return {
      ok: false,
      appid: id,
      achievements: [],
      error: 'Steam 未返回游戏 schema（可能 appid 无效或暂无统计数据）。',
    };
  }
  const raw = game.availableGameStats?.achievements ?? [];
  const achievements = raw.map((a) => ({
    name: a.name ?? '',
    displayName: a.displayName ?? a.name ?? '',
    description: a.description ?? '',
    hidden: Boolean(a.hidden),
    icon: a.icon ?? null,
  }));
  return {
    ok: true,
    appid: id,
    gameName: game.gameName ?? null,
    achievements,
  };
}

/** 愿望单 appid 列表（IWishlistService/GetWishlist）。 */
export async function fetchWishlistAppids(apiKey, steamid) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const url =
    `${WEBAPI_BASE}/IWishlistService/GetWishlist/v1/` +
    `?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid)}`;
  const json = await getJson(url, { label: 'GetWishlist' });
  const items = json?.response?.items ?? [];
  const appids = items.map((it) => Number(it.appid)).filter((n) => Number.isInteger(n) && n > 0);
  return { appids, raw: items };
}

/** 最近在玩（GetRecentlyPlayedGames）。 */
export async function fetchRecentlyPlayed(apiKey, steamid, opts = {}) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const count = Math.max(1, Math.min(50, Number(opts.count) || 10));
  const url =
    `${WEBAPI_BASE}/IPlayerService/GetRecentlyPlayedGames/v1/` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamid)}&count=${count}`;
  const json = await getJson(url, { label: 'GetRecentlyPlayedGames' });
  const r = json?.response ?? {};
  const items = (r.games ?? []).map((g) => ({
    appid: g.appid,
    name: g.name ?? `appid ${g.appid}`,
    twoWeeksMinutes: g.playtime_2weeks ?? 0,
    totalMinutes: g.playtime_forever ?? 0,
    lastPlayed: g.rtime_last_played
      ? new Date(g.rtime_last_played * 1000).toISOString()
      : null,
  }));
  return {
    steamid,
    totalCount: r.total_count ?? items.length,
    items,
  };
}

/** 等级 + 徽章（GetSteamLevel + GetBadges）。 */
export async function fetchSteamLevel(apiKey, steamid) {
  if (!apiKey) throw new Error('需要 Steam Web API Key');
  const levelUrl =
    `${WEBAPI_BASE}/IPlayerService/GetSteamLevel/v1/` +
    `?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid)}`;
  const badgesUrl =
    `${WEBAPI_BASE}/IPlayerService/GetBadges/v1/` +
    `?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid)}`;
  const [levelJson, badgesJson] = await Promise.all([
    getJson(levelUrl, { label: 'GetSteamLevel' }),
    getJson(badgesUrl, { label: 'GetBadges' }),
  ]);
  const level = Number(levelJson?.response?.player_level);
  const br = badgesJson?.response ?? {};
  const badges = (br.badges ?? []).slice(0, 20).map((b) => ({
    badgeid: b.badgeid,
    appid: b.appid ?? null,
    level: b.level ?? 0,
    xp: b.xp ?? 0,
  }));
  return {
    steamid,
    level: Number.isFinite(level) ? level : 0,
    xp: Number(br.player_xp) || 0,
    badgeCount: (br.badges ?? []).length,
    badges,
  };
}
