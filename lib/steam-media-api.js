/**
 * 商店媒体 / DLC：基于 appdetails（免 Key）。
 * 独立文件，避免把 steam-api.js 撑过 400 行。
 */

const STORE_BASE = 'https://store.steampowered.com/api/appdetails';
const UA = 'dsh-steam/0.7 (+https://github.com/)';
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

async function loadAppData(appid, opts = {}) {
  const id = Number(appid);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, appid, error: `appid 无效：${appid}。必须是正整数。` };
  }
  const cc = (opts.cc ?? 'cn').toLowerCase();
  const lang = opts.lang ?? 'schinese';
  const url = `${STORE_BASE}?appids=${id}&cc=${encodeURIComponent(cc)}&l=${encodeURIComponent(lang)}`;
  const json = await getJson(url, { label: `appdetails(${id})` });
  const entry = json?.[String(id)];
  if (!entry?.success || !entry.data) {
    return {
      ok: false,
      appid: id,
      error: '商店没有返回该 appid（可能区服不可见、下架，或 appid 写错）',
    };
  }
  return { ok: true, appid: id, data: entry.data, cc };
}

/**
 * 截图 / 预告片 URL（不下载）。
 * kind: screenshots | movies | all
 */
export async function fetchAppMedia(appid, opts = {}) {
  const kind = String(opts.kind ?? 'all').toLowerCase();
  if (!['screenshots', 'movies', 'all'].includes(kind)) {
    return {
      ok: false,
      appid: Number(appid) || appid,
      screenshots: [],
      movies: [],
      error: `kind「${kind}」无效。可选：screenshots、movies、all。`,
    };
  }
  const loaded = await loadAppData(appid, opts);
  if (!loaded.ok) {
    return { ok: false, appid: loaded.appid, screenshots: [], movies: [], error: loaded.error };
  }
  const limit = Math.max(1, Math.min(30, Number(opts.limit) || 10));
  const d = loaded.data;

  let screenshots = [];
  let movies = [];
  if (kind === 'screenshots' || kind === 'all') {
    screenshots = (d.screenshots ?? []).slice(0, limit).map((s) => ({
      id: s.id,
      thumbUrl: s.path_thumbnail ?? null,
      fullUrl: s.path_full ?? null,
    }));
  }
  if (kind === 'movies' || kind === 'all') {
    movies = (d.movies ?? []).slice(0, limit).map((m) => ({
      id: m.id,
      name: m.name ?? '',
      thumbUrl: m.thumbnail ?? null,
      // 优先 dash，其次 hls；都没有给 null（不下载）
      h264Url: m.dash_h264 || m.hls_h264 || null,
    }));
  }

  return {
    ok: true,
    appid: loaded.appid,
    name: d.name,
    screenshots,
    movies,
  };
}

/** DLC appid 列表（只读 appdetails.dlc，查价由工具层限流）。 */
export async function fetchAppDlcIds(appid, opts = {}) {
  const loaded = await loadAppData(appid, opts);
  if (!loaded.ok) {
    return { ok: false, appid: loaded.appid, dlcIds: [], error: loaded.error };
  }
  const dlcIds = (loaded.data.dlc ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    ok: true,
    appid: loaded.appid,
    name: loaded.data.name,
    dlcIds,
    cc: loaded.cc,
  };
}
