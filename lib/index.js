/**
 * 工具层入口：dsh-steam 插件（DSH cordis 宿主端）。
 *
 * 分层：
 *   steam-api.js       网络
 *   steam-local.js     本机 VDF/ACF
 *   price-history.js   价格历史
 *   register-*.js      六个工具的 defineTool
 *   tool-helpers.js    渲染 / safe / steam://
 *   index.js           插件元数据 + apply
 *
 * 契约要点：
 *   - export const inject = ['tools']（缺了报 cannot get property "tools" without inject）
 *   - parameters 是「属性名 → 定义」扁平映射，不要套 type:'object'/properties
 *   - 任何网络抖动 / 脏文件都不得抛到宿主：统一 ok:false + 中文 summary
 */

import { registerAllTools } from './register-tools.js';

export const name = 'dsh-steam';

/** 声明依赖的宿主服务；少了这一行 cordis 会拒绝 ctx.tools。 */
export const inject = ['tools'];

/**
 * @param {object} ctx cordis 上下文
 * @param {object} [config] 插件配置（apiKey / steamId / cc）
 */
export function apply(ctx, config = {}) {
  registerAllTools(ctx, config ?? {});
}
