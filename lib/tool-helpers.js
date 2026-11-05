/**
 * 工具层共用：渲染、安全包装、steam:// 唤起、参数片段。
 */

import { spawn } from 'node:child_process';

/** 人读 summary + 完整 JSON。 */
export function renderResult(_args, value) {
  const head = typeof value?.summary === 'string' ? value.summary : '';
  const body = JSON.stringify(value, null, 2);
  return [{ type: 'text', text: head ? `${head}\n\n${body}` : body }];
}

/** 输出 schema 只强制 ok/summary。 */
export const looseOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean', required: true },
    summary: { type: 'string', required: true },
  },
};

/**
 * appids 用 type:'json'（DSH 无 array 类型）。
 * 切勿写成 { type:'object', properties:{...} }。
 */
export const appidsParam = {
  type: 'json',
  required: true,
  description: 'Steam appid 数组，例如 [730, 1245620]（CS2、艾尔登法环）',
};

/** 异常 → ok:false，避免打穿宿主。 */
export function safe(execute) {
  return async (args, ctx) => {
    try {
      return await execute(args, ctx);
    } catch (err) {
      const msg = err?.message ?? String(err);
      return {
        ok: false,
        summary: `工具执行失败：${msg}。若是网络问题请稍后重试；若持续失败请检查本机 Steam / API Key 配置。`,
      };
    }
  };
}

/**
 * 打开任意 steam:// URI。拒绝非 steam 协议，避免命令注入。
 * Windows start 必须带空标题 ""，否则 URI 会被当成窗口标题。
 */
export function launchSteamUri(uri) {
  if (typeof uri !== 'string' || !/^steam:\/\//i.test(uri)) {
    return Promise.reject(new Error(`拒绝打开非 steam:// 链接：${uri}`));
  }
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      const comspec = process.env.ComSpec || 'cmd.exe';
      child = spawn(comspec, ['/c', 'start', '""', uri], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [uri], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [uri], { detached: true, stdio: 'ignore' });
    }
    child.once('error', (err) =>
      reject(new Error(`无法唤起 Steam：${err?.message ?? err}。请确认已安装并登录 Steam。`)),
    );
    child.once('spawn', () => {
      child.unref();
      resolve(uri);
    });
  });
}

/** 安装协议：仅由数字 appid 拼接。 */
export function launchSteamUrl(appid) {
  return launchSteamUri(`steam://install/${appid}`);
}

/**
 * 解析 steam_open 的 target → steam:// URI。
 * 仅三种写法；url: 只允许 store.steampowered.com。
 */
export function resolveOpenTarget(target) {
  const raw = String(target ?? '').trim();
  if (!raw) {
    return { ok: false, error: 'target 为空。可用：纯 appid、run:<appid>、url:https://store.steampowered.com/...' };
  }
  if (/^\d+$/.test(raw)) {
    const appid = Number(raw);
    if (!Number.isInteger(appid) || appid <= 0) {
      return { ok: false, error: `appid 无效：${raw}` };
    }
    return { ok: true, uri: `steam://store/${appid}` };
  }
  const run = raw.match(/^run:(\d+)$/i);
  if (run) {
    const appid = Number(run[1]);
    return { ok: true, uri: `steam://run/${appid}` };
  }
  const urlMatch = raw.match(/^url:(.+)$/i);
  if (urlMatch) {
    let parsed;
    try {
      parsed = new URL(urlMatch[1].trim());
    } catch {
      return { ok: false, error: 'url: 后面必须是合法的 https URL。' };
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: '只允许 http(s) 商店链接，其它 scheme 已拒绝。' };
    }
    if (parsed.hostname.toLowerCase() !== 'store.steampowered.com') {
      return {
        ok: false,
        error: `域名「${parsed.hostname}」不在白名单。只允许 store.steampowered.com。`,
      };
    }
    return { ok: true, uri: `steam://openurl/${parsed.href}` };
  }
  return {
    ok: false,
    error:
      `无法识别 target「${raw}」。支持：纯数字 appid、run:<appid>、url:https://store.steampowered.com/...`,
  };
}

/** register + effect 清理。 */
export function makeRegister(ctx) {
  return (tool) => {
    const dispose = ctx.tools.register(tool);
    ctx.effect?.(() => dispose);
  };
}
