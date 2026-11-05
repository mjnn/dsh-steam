/**
 * 免 Key 的统计接口：在线人数、全球成就完成率。
 * 从 steam-api.js 拆出，避免单文件超 400 行。
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
        ? `超时 ${timeoutMs}ms（网络慢或被墙，可稍后重试）`
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

/** 当前在线人数（GetNumberOfCurrentPlayers，免 Key）。 */
export async function fetchPlayerCount(appid) {
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, appid, error: `appid 无效：${appid}。必须是正整数。` };
  }
  const url = `${WEBAPI_BASE}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${id}`;
  const json = await getJson(url, { label: `GetNumberOfCurrentPlayers(${id})` });
  const r = json?.response;
  if (!r || r.result !== 1 || typeof r.player_count !== 'number') {
    return {
      ok: false,
      appid: id,
      error: 'Steam 未返回有效在线人数（result≠1）。可能 appid 无效或接口暂时不可用。',
    };
  }
  return { ok: true, appid: id, playerCount: r.player_count };
}

/**
 * 全球成就完成率。percent 接口给字符串，转数字后按升序（最难在前）。
 */
export async function fetchGlobalAchievements(appid, opts = {}) {
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, appid, items: [], error: `appid 无效：${appid}。必须是正整数。` };
  }
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 10));
  const url =
    `${WEBAPI_BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/` +
    `?gameid=${id}`;
  const json = await getJson(url, { label: `GetGlobalAchievementPercentages(${id})` });
  const raw = json?.achievementpercentages?.achievements ?? [];
  const items = raw
    .map((a) => ({
      name: a.name ?? '',
      percent: Number(a.percent),
    }))
    .filter((a) => a.name && Number.isFinite(a.percent))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, limit);
  return { ok: true, appid: id, items };
}
