/**
 * 汇总注册六个 steam_* 工具。
 */

import { makeRegister } from './tool-helpers.js';
import { registerStoreTools } from './register-store-tools.js';
import { registerLocalTools } from './register-local-tools.js';

export function registerAllTools(ctx, cfg) {
  const register = makeRegister(ctx);
  registerStoreTools(register, cfg);
  registerLocalTools(register, cfg);
}
