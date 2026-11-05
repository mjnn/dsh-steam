/**
 * 从本机 Steam loginusers.vdf 猜当前账号 SteamID64。
 * 仅作「参数/配置都没给 steamid」时的兜底，找不到就返回 null。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSteamRoot } from './steam-local.js';

export function findLocalSteamId() {
  try {
    const root = findSteamRoot();
    if (!root) return null;
    const vdf = join(root, 'config', 'loginusers.vdf');
    if (!existsSync(vdf)) return null;
    const text = readFileSync(vdf, 'utf8');
    // 优先 MostRecent "1" 的块；块名本身是 SteamID64
    const blocks = [...text.matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)];
    let fallback = null;
    for (const m of blocks) {
      const id = m[1];
      const body = m[2];
      fallback = fallback ?? id;
      if (/"MostRecent"\s*"1"/.test(body)) return id;
    }
    return fallback;
  } catch {
    return null;
  }
}
