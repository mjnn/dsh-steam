/**
 * 需 Key 的账号接口：好友 / 个人成就 / 愿望单。
 */

const WEBAPI_BASE = 'https://api.steampowered.com';
const UA = 'dsh-steam/0.6 (+https://github.com/)';
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
