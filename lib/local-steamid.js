/**
 * SteamID 解析（所有需 steamid 的工具共用）。
 *
 * 顺序（不得改）：
 *   args.steamid → args.vanity → config.steamId → DSH_STEAM_ID → 本机 loginusers.vdf
 *
 * loginusers.vdf 选取规则：
 *   1) MostRecent=1
 *   2) 仅有一个账号时用该账号
 *   3) 否则取 Timestamp 最大的
 *   不在多账号时盲目取「文件里第一个」。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSteamRoot } from './steam-local.js';
import { resolveVanity } from './steam-api.js';

/** @returns {{ id: string, mostRecent: boolean, timestamp: number }[]} */
function parseLoginUsers(text) {
  const out = [];
  // 单层用户块；字段较少，[^}]* 足够
  for (const m of text.matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)) {
    const id = m[1];
    const body = m[2];
    const mostRecent = /"MostRecent"\s*"1"/.test(body);
    const tsMatch = body.match(/"Timestamp"\s*"(\d+)"/i);
    const timestamp = tsMatch ? Number(tsMatch[1]) : 0;
    out.push({ id, mostRecent, timestamp });
  }
  return out;
}

/** 从本机 Steam loginusers.vdf 读取应使用的 SteamID64。 */
export function findLocalSteamId() {
  try {
    const root = findSteamRoot();
    if (!root) return null;
    const vdf = join(root, 'config', 'loginusers.vdf');
    if (!existsSync(vdf)) return null;
    const users = parseLoginUsers(readFileSync(vdf, 'utf8'));
    if (users.length === 0) return null;
    const recent = users.find((u) => u.mostRecent);
    if (recent) return recent.id;
    if (users.length === 1) return users[0].id;
    users.sort((a, b) => b.timestamp - a.timestamp);
    return users[0].timestamp > 0 ? users[0].id : null;
  } catch {
    return null;
  }
}

/**
 * 统一解析 steamid。
 * @param {string} apiKey 解析 vanity 时需要
 * @param {object} [args] 工具入参（steamid / vanity）
 * @param {object} [cfg] 插件配置（steamId）
 * @returns {Promise<{ ok:true, steamid:string } | { ok:false, summary:string }>}
 */
export async function resolveSteamid(apiKey, args = {}, cfg = {}) {
  const fromArg =
    args.steamid != null && String(args.steamid).trim() !== ''
      ? String(args.steamid).trim()
      : '';
  if (fromArg) return { ok: true, steamid: fromArg };

  const vanity =
    args.vanity != null && String(args.vanity).trim() !== ''
      ? String(args.vanity).trim()
      : '';
  if (vanity) {
    if (!apiKey) {
      return {
        ok: false,
        summary:
          '解析 vanity 需要 Steam Web API Key。请配置 apiKey 或环境变量 DSH_STEAM_API_KEY。',
      };
    }
    const id = (await resolveVanity(apiKey, vanity)) || '';
    if (!id) {
      return {
        ok: false,
        summary: `找不到自定义 URL「${vanity}」，请确认拼写或改用 SteamID64。`,
      };
    }
    return { ok: true, steamid: id };
  }

  const fromCfg =
    cfg.steamId != null && String(cfg.steamId).trim() !== ''
      ? String(cfg.steamId).trim()
      : '';
  if (fromCfg) return { ok: true, steamid: fromCfg };

  const fromEnv = process.env.DSH_STEAM_ID?.trim() || '';
  if (fromEnv) return { ok: true, steamid: fromEnv };

  const local = findLocalSteamId();
  if (local) return { ok: true, steamid: local };

  return {
    ok: false,
    summary:
      '无法解析 steamid。可按顺序提供：参数 steamid / vanity、插件配置 steamId、环境变量 DSH_STEAM_ID，或确保本机 Steam 已登录（loginusers.vdf）。',
  };
}
