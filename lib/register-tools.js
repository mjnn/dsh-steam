/**
 * 汇总注册全部 steam_* 工具。
 */

import { makeRegister } from './tool-helpers.js';
import { registerStoreTools } from './register-store-tools.js';
import { registerInfoTools } from './register-info-tools.js';
import { registerLocalTools } from './register-local-tools.js';

export function registerAllTools(ctx, cfg) {
  const register = makeRegister(ctx);
  registerStoreTools(register, cfg);
  registerInfoTools(register, cfg);
  registerLocalTools(register, cfg);
}
