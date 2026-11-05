/**
 * 本机 / 账号侧工具：steam_download_status / steam_install / steam_library
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  fetchOwnedGames,
  fetchPlayerSummary,
  resolveVanity,
  formatMinutes,
} from './steam-api.js';
import { listInstalledApps, summarize } from './steam-local.js';
import { renderResult, looseOutput, safe, launchSteamUrl } from './tool-helpers.js';

export function registerLocalTools(register, cfg) {
  register(
    defineTool({
      name: 'steam_download_status',
      description:
        '读取本机 Steam 安装目录（libraryfolders.vdf + appmanifest_*.acf），报告已安装/下载中/待更新、进度与体积。纯本地，无需网络与 Key。',
      parameters: {
        top: { type: 'integer', description: '体积排行前 N 个，默认 10' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 30000,
      execute: safe(async (args) => {
        const { steamRoot, libraries, apps } = listInstalledApps();
        if (!steamRoot) {
          return {
            ok: false,
            summary:
              '没找到 Steam 安装目录（注册表与常见路径都没命中）。请确认已安装 Steam，或检查是否用了便携版/非默认盘符。',
          };
        }

        const s = summarize(apps, libraries);
        const top = Math.max(1, Math.min(50, Number(args.top) || 10));
        const topBySize = s.topBySize.slice(0, top);

        const lines = [
          `Steam 根目录：${steamRoot}`,
          `共 ${s.counts.total} 个条目：已安装 ${s.counts.installed}，下载中 ${s.counts.downloading}，待更新 ${s.counts.needsUpdate}`,
          `占用合计：${s.totalGB} GB`,
        ];

        if (s.downloading.length > 0) {
          lines.push('', '正在下载：');
          for (const d of s.downloading) {
            lines.push(
              `· ${d.name} — ${d.downloadedGB}/${d.toDownloadGB} GB（${d.progressPercent}%）` +
                (d.updatePaused ? ' [已暂停]' : ''),
            );
          }
        }

        if (s.needsUpdate.length > 0) {
          lines.push('', '待更新：');
          for (const d of s.needsUpdate) lines.push(`· ${d.name}（appid ${d.appid}）`);
        }

        lines.push('', '体积排行：');
        for (const d of topBySize) lines.push(`· ${d.name} — ${d.sizeOnDiskGB} GB`);

        lines.push('', '各库剩余空间：');
        for (const l of s.libraries) lines.push(`· ${l.path} — 剩余 ${l.freeGB ?? '?'} GB`);

        return {
          ok: true,
          steamRoot,
          counts: s.counts,
          totalGB: s.totalGB,
          downloading: s.downloading,
          needsUpdate: s.needsUpdate,
          topBySize,
          libraries: s.libraries,
          summary: lines.join('\n'),
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_install',
      description:
        '让 Steam 开始下载/安装某个 appid（steam://install/<appid>）。需要本机 Steam 已登录。dryRun=true 时只返回链接不唤起。',
      parameters: {
        appid: { type: 'integer', required: true, description: '要安装的 Steam appid' },
        dryRun: {
          type: 'boolean',
          description: '为 true 时只返回将要打开的链接，不真的唤起 Steam',
        },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 20000,
      execute: safe(async (args) => {
        const appid = Number(args.appid);
        if (!Number.isInteger(appid) || appid <= 0) {
          return {
            ok: false,
            summary: `appid 无效：${args.appid}。必须是正整数，可用 steam_search 先查。`,
          };
        }
        const url = `steam://install/${appid}`;
        if (args.dryRun) {
          return {
            ok: true,
            appid,
            url,
            launched: false,
            summary: `演练模式：将打开 ${url}（未执行）`,
          };
        }
        await launchSteamUrl(appid);
        return {
          ok: true,
          appid,
          url,
          launched: true,
          summary: `已把 ${url} 交给系统处理。Steam 若已登录会弹出安装对话框并开始下载；可用资料库或下载队列确认。`,
        };
      }),
    }),
  );

  register(
    defineTool({
      name: 'steam_library',
      description:
        '读取 Steam 账号游戏库与游玩时长（需要 Web API Key，资料须公开）。可用 steamid 或 vanity；不填则用插件配置 steamId。',
      parameters: {
        steamid: { type: 'string', description: 'SteamID64（17 位数字），可省略' },
        vanity: {
          type: 'string',
          description: '个人资料自定义 URL 名，例如 gabelogannewell',
        },
        top: { type: 'integer', description: '只返回时长最多的前 N 个，默认 20' },
      },
      output: { schema: looseOutput, render: renderResult },
      timeoutMs: 45000,
      execute: safe(async (args) => {
        const apiKey = cfg.apiKey || process.env.DSH_STEAM_API_KEY || '';
        if (!apiKey) {
          return {
            ok: false,
            summary:
              '缺少 Steam Web API Key。到 https://steamcommunity.com/dev/apikey 申请后，填入插件配置的 apiKey（或环境变量 DSH_STEAM_API_KEY）。',
          };
        }

        let steamid = args.steamid || cfg.steamId || '';
        if (!steamid && args.vanity) {
          steamid = (await resolveVanity(apiKey, args.vanity)) || '';
          if (!steamid) {
            return {
              ok: false,
              summary: `找不到自定义 URL「${args.vanity}」，请确认拼写或改用 SteamID64。`,
            };
          }
        }
        if (!steamid) {
          return {
            ok: false,
            summary: '需要 steamid 或 vanity 才能查库。可在插件配置里预置 steamId。',
          };
        }

        const player = await fetchPlayerSummary(apiKey, steamid);
        const lib = await fetchOwnedGames(apiKey, steamid);
        const top = Math.max(1, Math.min(200, Number(args.top) || 20));
        const topGames = lib.games.slice(0, top).map((g) => ({
          ...g,
          playtimeText: formatMinutes(g.playtimeMinutes),
        }));

        if (lib.gameCount === 0) {
          return {
            ok: false,
            summary:
              'Steam 返回了 0 个游戏。通常是「游戏详情」隐私设置不是公开，或该账号确实没有游戏。请到个人资料 → 隐私设置改为公开后再试。',
            player,
          };
        }

        return {
          ok: true,
          player,
          gameCount: lib.gameCount,
          totalPlaytimeMinutes: lib.totalPlaytimeMinutes,
          totalPlaytimeText: formatMinutes(lib.totalPlaytimeMinutes),
          topGames,
          summary: [
            `${player?.personaName ?? steamid}：共 ${lib.gameCount} 个游戏，总计 ${formatMinutes(lib.totalPlaytimeMinutes)}`,
            ...topGames.map((g) => `· ${g.name} — ${g.playtimeText}`),
          ].join('\n'),
        };
      }),
    }),
  );
}
