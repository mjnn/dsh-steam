/**
 * 历史层：把每次查到的价格记下来，用来判断「是不是观测史低」。
 *
 * 默认路径：~/.dsh/steam-price-history.json
 * 覆盖：环境变量 DSH_STEAM_HISTORY（测试必须用它写到临时目录）。
 *
 * 损坏文件当空库处理——宁可丢历史，也不让 steam_watch 整工具失败。
 * 同日重复查询只覆盖当天一条；history 最多 90 条。
 *
 * 注意：这是本机观测低价，不是 Steam 官方历史；首次样本会被当成基线。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_HISTORY = 90;

/** 解析存储路径；优先环境变量，便于沙盒测试。 */
export function defaultStorePath() {
  const override = process.env.DSH_STEAM_HISTORY;
  if (override && override.trim() !== '') return override.trim();
  return join(homedir(), '.dsh', 'steam-price-history.json');
}

function emptyStore() {
  return { version: 1, apps: {} };
}

/** 读存储；损坏 / 缺字段 → 空库，不抛错。 */
export function loadStore(path = defaultStorePath()) {
  try {
    if (!existsSync(path)) return emptyStore();
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.apps || typeof parsed.apps !== 'object') {
      return emptyStore();
    }
    return { version: parsed.version ?? 1, apps: parsed.apps };
  } catch {
    return emptyStore();
  }
}

/** 写回；失败返回 false，由工具层降级为 historySaved:false。 */
export function saveStore(store, path = defaultStorePath()) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 本地时区的 YYYY-MM-DD（不用 toISOString，避免 UTC 跨日错位）。 */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 记录一个价格样本，并判断是否刷新观测史低。
 *
 * @param store 已加载对象（就地修改）
 * @param app { appid, name, currency, finalCents }
 * @returns {{ isNewLow: boolean, previousLowCents: number|null, isFirstSample: boolean }}
 */
export function recordPrice(store, app) {
  const key = String(app.appid);
  const entry = store.apps[key] ?? {
    name: app.name,
    currency: app.currency ?? 'CNY',
    lowestCents: null,
    lowestDate: null,
    samples: 0,
    lastCents: null,
    lastSeen: null,
    history: [],
  };

  if (!Array.isArray(entry.history)) entry.history = [];

  const cents = Number(app.finalCents);
  const isFirstSample = (entry.samples ?? 0) === 0;
  const previousLowCents = entry.lowestCents;

  if (Number.isFinite(cents) && cents >= 0) {
    const d = today();
    const last = entry.history[entry.history.length - 1];
    if (last && last.date === d) last.cents = cents;
    else entry.history.push({ date: d, cents });

    if (entry.history.length > MAX_HISTORY) {
      entry.history = entry.history.slice(-MAX_HISTORY);
    }

    if (entry.lowestCents === null || cents < entry.lowestCents) {
      entry.lowestCents = cents;
      entry.lowestDate = d;
    }
    entry.lastCents = cents;
    entry.lastSeen = d;
    entry.samples = (entry.samples ?? 0) + 1;
    entry.name = app.name ?? entry.name;
    entry.currency = app.currency ?? entry.currency;
  }

  store.apps[key] = entry;

  // 首次样本不算「新低」——没有基线可比，调用方应标「首次记录」
  const isNewLow =
    !isFirstSample &&
    Number.isFinite(cents) &&
    Number.isFinite(previousLowCents) &&
    cents < previousLowCents;

  return { isNewLow, previousLowCents, isFirstSample };
}

/** 「分」→ 带货币符号的金额；非法值返回 —。 */
export function fmtCents(cents, currency = 'CNY') {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return '—';
  const symbol = currency === 'CNY' ? '¥' : '$';
  return `${symbol} ${(Number(cents) / 100).toFixed(2)}`;
}
