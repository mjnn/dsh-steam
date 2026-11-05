/**
 * 本地层：读本机 Steam 安装目录里的 VDF / ACF，不访问网络。
 *
 * 探测顺序：注册表 SteamPath → 常见候选路径（Windows / macOS / Linux）。
 * 不得写死某台机器的用户目录；候选路径只覆盖发行版默认安装位置。
 *
 * 判定口径（与 SPEC 一致，勿改）：
 *   installed    = StateFlags 含位 4
 *   needsUpdate  = StateFlags 含位 2
 *   downloading  = BytesToDownload > 0 && BytesDownloaded > 0
 *                  && BytesDownloaded < BytesToDownload
 *   （只比较前两者会把「有更新但没开始」误判成下载中）
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const STATE_FLAGS = {
  UPDATE_REQUIRED: 2,
  INSTALLED: 4,
  UPDATE_RUNNING: 256,
  UPDATE_PAUSED: 512,
};

/** 读文本：剥 UTF-8 BOM；ACF 偶发带 BOM 会导致首个 key 匹配失败。 */
function readText(filePath) {
  const buf = readFileSync(filePath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

/** 规范化路径分隔符，便于跨 Windows / POSIX 比较。 */
function normalizePath(p) {
  return String(p).replace(/\//g, process.platform === 'win32' ? '\\' : '/');
}

/**
 * 库路径去重键。
 * Windows 上注册表常返回小写路径，vdf 写正常大小写；按原串去重会把同一库扫两遍。
 * 优先 realpath（吃掉软链/短名），失败再 toLowerCase；非 Windows 保持大小写敏感。
 */
function libraryDedupeKey(p) {
  const normalized = normalizePath(p);
  try {
    const real = realpathSync.native(normalized);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }
}

/** 常见 Steam 根目录候选（不含用户专属盘符以外的臆测）。 */
function candidateRoots() {
  const home = homedir();
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'E:\\Steam',
    ];
  }
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'Steam')];
  }
  // Linux：发行版 / Flatpak / 旧路径
  return [
    join(home, '.steam', 'steam'),
    join(home, '.local', 'share', 'Steam'),
    join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
  ];
}

/** 从注册表读 SteamPath（仅 Windows）；失败静默，交给候选路径。 */
function registrySteamPath() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    );
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/** 探测 Steam 根目录；找不到返回 null（工具层转成 ok:false）。 */
export function findSteamRoot() {
  const candidates = [];
  const fromReg = registrySteamPath();
  if (fromReg) candidates.push(fromReg);
  candidates.push(...candidateRoots());

  for (const c of candidates) {
    const root = normalizePath(c);
    if (existsSync(join(root, 'steamapps'))) return root;
  }
  return null;
}

/** 解析 libraryfolders.vdf 中的库路径（含主目录本身）；Windows 上大小写不敏感去重。 */
export function readLibraryFolders(steamRoot) {
  const vdf = join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  // key = 去重键，value = 保留的展示路径（先遇到的那条）
  const byKey = new Map();
  const addLib = (raw) => {
    const path = normalizePath(String(raw).replace(/\\\\/g, '\\'));
    if (!existsSync(join(path, 'steamapps'))) return;
    const key = libraryDedupeKey(path);
    if (!byKey.has(key)) byKey.set(key, path);
  };

  addLib(steamRoot);
  if (existsSync(vdf)) {
    try {
      const text = readText(vdf);
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
        // VDF 里 Windows 路径写成 C:\\Games\\Steam
        addLib(m[1]);
      }
    } catch {
      // 损坏的 vdf 不阻断：至少还能扫主目录
    }
  }
  return [...byKey.values()];
}

/** 解析单个 appmanifest_*.acf。 */
export function parseManifest(filePath) {
  const text = readText(filePath);
  const str = (key) => {
    const m = text.match(new RegExp(`"${key}"\\s+"([^"]*)"`));
    return m ? m[1] : '';
  };
  const num = (key) => {
    const n = Number(str(key));
    return Number.isFinite(n) ? n : 0;
  };

  const flags = num('StateFlags');
  const sizeOnDisk = num('SizeOnDisk');
  const toDownload = num('BytesToDownload');
  const downloaded = num('BytesDownloaded');
  const lastUpdated = num('LastUpdated');

  const installed = (flags & STATE_FLAGS.INSTALLED) !== 0;
  const needsUpdate = (flags & STATE_FLAGS.UPDATE_REQUIRED) !== 0;
  const updateRunning = (flags & STATE_FLAGS.UPDATE_RUNNING) !== 0;
  const updatePaused = (flags & STATE_FLAGS.UPDATE_PAUSED) !== 0;

  // 必须三者同时成立，否则「有更新但未开始」会被算进下载中
  const downloading = toDownload > 0 && downloaded > 0 && downloaded < toDownload;
  // 非下载中一律 null：不要用 100 冒充「没在下」（needsUpdate 常见 downloaded=0）
  const progressPercent = downloading
    ? Math.round((downloaded / toDownload) * 1000) / 10
    : null;

  return {
    appid: num('appid'),
    name: str('name'),
    installDir: str('installdir'),
    stateFlags: flags,
    installed,
    needsUpdate,
    updateRunning,
    updatePaused,
    downloading,
    sizeOnDiskGB: +(sizeOnDisk / 1024 ** 3).toFixed(2),
    toDownloadGB: +(toDownload / 1024 ** 3).toFixed(2),
    downloadedGB: +(downloaded / 1024 ** 3).toFixed(2),
    progressPercent,
    lastUpdated: lastUpdated ? new Date(lastUpdated * 1000).toISOString() : null,
    libraryPath: filePath,
  };
}

/** 扫描所有库，返回游戏列表。单个坏清单不影响其它；同一 appid 只保留先遇到的一条。 */
export function listInstalledApps(steamRoot = findSteamRoot()) {
  if (!steamRoot) return { steamRoot: null, libraries: [], apps: [] };
  const libraries = readLibraryFolders(steamRoot);
  const apps = [];
  const seenAppids = new Set();
  for (const lib of libraries) {
    const dir = join(lib, 'steamapps');
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const app = { ...parseManifest(join(dir, f)), libraryPath: lib };
        // 多库残留同一 appid 时只留一条，否则体积/条目会翻倍
        if (seenAppids.has(app.appid)) continue;
        seenAppids.add(app.appid);
        apps.push(app);
      } catch {
        // 跳过脏文件
      }
    }
  }
  return { steamRoot, libraries, apps };
}

/** 库所在磁盘剩余空间（GB）；不可读时返回 null。 */
export function freeSpaceGB(path) {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return null;
    const s = statfsSync(path);
    return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return null;
  }
}

/**
 * 汇总下载中 / 已安装 / 待更新 / 体积排行。
 * counts 严格按 SPEC 位标志；needsUpdate 列表排除正在下载的，避免 UI 重复。
 */
export function summarize(apps, libraries) {
  const downloading = apps.filter((a) => a.downloading);
  const needsUpdateList = apps.filter((a) => a.needsUpdate && !a.downloading);

  const bySize = [...apps].sort((a, b) => b.sizeOnDiskGB - a.sizeOnDiskGB);
  const totalGB = Math.round(apps.reduce((s, a) => s + a.sizeOnDiskGB, 0) * 10) / 10;

  return {
    counts: {
      total: apps.length,
      // 含位 4 即算已安装（下载中的也仍是 installed）
      installed: apps.filter((a) => a.installed).length,
      downloading: downloading.length,
      // 含位 2 即算待更新（与列表是否去重无关）
      needsUpdate: apps.filter((a) => a.needsUpdate).length,
    },
    totalGB,
    downloading,
    needsUpdate: needsUpdateList,
    topBySize: bySize.slice(0, 10),
    libraries: libraries.map((p) => ({ path: p, freeGB: freeSpaceGB(p) })),
  };
}
