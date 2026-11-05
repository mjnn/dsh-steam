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
 * 打开 steam://。URL 只由数字 appid 拼接。
 * Windows start 必须带空标题 ""，否则 URL 会被当成窗口标题。
 */
export function launchSteamUrl(appid) {
  const url = `steam://install/${appid}`;
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      const comspec = process.env.ComSpec || 'cmd.exe';
      child = spawn(comspec, ['/c', 'start', '""', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.once('error', (err) =>
      reject(new Error(`无法唤起 Steam：${err?.message ?? err}。请确认已安装并登录 Steam。`)),
    );
    child.once('spawn', () => {
      child.unref();
      resolve(url);
    });
  });
}

/** register + effect 清理。 */
export function makeRegister(ctx) {
  return (tool) => {
    const dispose = ctx.tools.register(tool);
    ctx.effect?.(() => dispose);
  };
}
