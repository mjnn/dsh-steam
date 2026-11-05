/**
 * dsh-steam 发布脚本：校验 → 构建 → 出清单。
 *
 * 用法：node tools/release.mjs
 * 任一校验失败 → 退出码 1，且不产出任何发布物。
 *
 * 规则见 aidlc-docs/MATERIAL-GOVERNANCE.md §2–§3、§6–§7。
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

/** SPEC §3 规定的工具名（顺序无关；v0.4.0 起含 steam_deals）。 */
const REQUIRED_TOOLS = new Set([
  'steam_price',
  'steam_search',
  'steam_watch',
  'steam_download_status',
  'steam_install',
  'steam_library',
  'steam_deals',
]);

/** MAJOR.MINOR.PATCH only —— 拒绝 -rc / -final 等后缀（治理命名规则）。 */
const STRICT_SEMVER = /^\d+\.\d+\.\d+$/;

const PATH_LEAK = /[A-Za-z]:\\Users\\/;
const SECRET_LEAK = /sk-[A-Za-z0-9]{16,}/;

function fail(check, how) {
  console.error(`\n❌ 校验失败：${check}`);
  console.error(`   怎么修：${how}`);
  process.exit(1);
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function listLibJs() {
  const libDir = join(ROOT, 'lib');
  return readdirSync(libDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(libDir, f))
    .sort();
}

/** 递归列出目录下所有文件（相对 posix 风格路径）。 */
function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out.sort();
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    ...opts,
  });
  return r;
}

// ───────── 校验 ─────────

function loadPackage() {
  const pkgPath = join(ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    fail('无法读取 package.json', `确认 ${pkgPath} 是合法 JSON：${err.message}`);
  }
  return pkg;
}

function checkVersion(pkg) {
  const version = String(pkg.version ?? '');
  if (!STRICT_SEMVER.test(version)) {
    fail(
      `package.json.version「${version}」不是合法的 MAJOR.MINOR.PATCH`,
      '改成纯数字三段，例如 0.3.0；不要带 -rc1 / -final / -new 等后缀（见 MATERIAL-GOVERNANCE §2）',
    );
  }
  const tgzName = `dsh-steam-${version}.tgz`;
  // 命名一致性：版本即文件名中间段，无额外修饰
  if (tgzName !== `dsh-steam-${version}.tgz` || /-(final|new|副本)/i.test(tgzName)) {
    fail(`发布物命名非法：${tgzName}`, '文件名必须是 dsh-steam-<MAJOR.MINOR.PATCH>.tgz');
  }
  return { version, tgzName };
}

function checkDependencies(pkg) {
  const deps = pkg.dependencies;
  if (deps && typeof deps === 'object' && Object.keys(deps).length > 0) {
    fail(
      `dependencies 非空：${Object.keys(deps).join(', ')}`,
      'SPEC 要求零运行时依赖；删掉 dependencies，只允许 Node 内置模块（peerDependencies 可保留）',
    );
  }
}

function checkSyntax() {
  const files = listLibJs();
  if (files.length === 0) {
    fail('lib/ 下没有 .js 文件', '确认实现代码在 lib/');
  }
  for (const file of files) {
    const r = run(NODE, ['--check', file]);
    if (r.status !== 0) {
      fail(
        `node --check 失败：${relative(ROOT, file)}`,
        `修复语法错误后重试。stderr:\n${r.stderr || r.stdout || '(无输出)'}`,
      );
    }
  }
  return files;
}

function checkSelftest() {
  const started = Date.now();
  const r = run(NODE, ['test/selftest.mjs']);
  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.now() - started;
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';

  if (r.status !== 0) {
    fail(
      'test/selftest.mjs 未通过',
      `修好自检后再发布。exit=${r.status}\n${stdout}\n${stderr}`,
    );
  }

  const m = stdout.match(/注册的工具:\s*(.+)/);
  if (!m) {
    fail(
      '自检 stdout 里找不到「注册的工具: …」行',
      '确认 selftest 仍打印该行，且脚本能解析到工具名列表',
    );
  }
  const toolNames = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();

  const got = new Set(toolNames);
  const missing = [...REQUIRED_TOOLS].filter((t) => !got.has(t));
  const extra = toolNames.filter((t) => !REQUIRED_TOOLS.has(t));
  if (missing.length || extra.length || got.size !== REQUIRED_TOOLS.size) {
    fail(
      `工具名集合与 SPEC §3 不一致：实际=[${toolNames.join(', ')}]`,
      `必须恰好是这 ${REQUIRED_TOOLS.size} 个（顺序无关）：${[...REQUIRED_TOOLS].sort().join(', ')}` +
        (missing.length ? `\n缺少：${missing.join(', ')}` : '') +
        (extra.length ? `\n多余：${extra.join(', ')}` : ''),
    );
  }

  return {
    toolNames: [...REQUIRED_TOOLS].sort(),
    tests: {
      cmd: 'node test/selftest.mjs',
      passed: true,
      finishedAt,
    },
    elapsedMs,
  };
}

function scanLeaks() {
  const targets = [
    ...listLibJs(),
    join(ROOT, 'README.md'),
  ].filter((p) => existsSync(p));

  const hits = [];
  for (const file of targets) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (PATH_LEAK.test(line)) {
        hits.push({ file: relative(ROOT, file), line: i + 1, kind: '本机绝对路径', sample: line.trim().slice(0, 120) });
      }
      if (SECRET_LEAK.test(line)) {
        hits.push({ file: relative(ROOT, file), line: i + 1, kind: '疑似密钥', sample: line.trim().slice(0, 120) });
      }
    });
  }
  if (hits.length) {
    const detail = hits
      .map((h) => `  - ${h.file}:${h.line} [${h.kind}] ${h.sample}`)
      .join('\n');
    fail(
      `扫描到禁止内容（本机路径 / 疑似密钥）共 ${hits.length} 处`,
      `删掉或改掉以下命中后再发布：\n${detail}`,
    );
  }
}

// ───────── 构建 ─────────

function stagePackage() {
  const required = ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml', 'lib'];
  for (const name of required) {
    if (!existsSync(join(ROOT, name))) {
      fail(`缺少发布必需文件：${name}`, '补齐后再跑 release');
    }
  }

  const staging = mkdtempSync(join(tmpdir(), 'dsh-steam-release-'));
  const pkgDir = join(staging, 'package');
  mkdirSync(pkgDir, { recursive: true });

  for (const name of ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml']) {
    copyFileSync(join(ROOT, name), join(pkgDir, name));
  }
  cpSync(join(ROOT, 'lib'), join(pkgDir, 'lib'), { recursive: true });

  return { staging, pkgDir };
}

function buildTgz(version, tgzName, pkgDir, staging) {
  const tgzPath = join(ROOT, tgzName);
  // 先写到临时文件，校验全过后才原子替换到项目根——失败路径保证「不产出发布物」
  const tmpTgz = join(staging, tgzName);

  const r = run('tar', ['-czf', tmpTgz, '-C', staging, 'package']);
  if (r.status !== 0) {
    rmSync(staging, { recursive: true, force: true });
    fail(
      'tar 打包失败',
      `确认系统有 tar（Windows 10+ 自带 bsdtar）。stderr:\n${r.stderr || r.stdout || '(无输出)'}`,
    );
  }

  const filesMeta = listFilesRecursive(pkgDir).map((relPath) => {
    const full = join(pkgDir, relPath);
    const st = statSync(full);
    return {
      path: relPath,
      bytes: st.size,
      sha256: sha256File(full),
    };
  });

  const tgzSha = sha256File(tmpTgz);
  const tgzBytes = statSync(tmpTgz).size;

  // 成功后才落到项目根
  copyFileSync(tmpTgz, tgzPath);

  return { tgzPath, tgzSha, tgzBytes, filesMeta };
}

function writeManifest(version, tgzName, tgzSha, filesMeta, toolNames, tests) {
  const dir = join(ROOT, 'release', version);
  mkdirSync(dir, { recursive: true });
  const specPath = join(ROOT, 'SPEC.md');
  if (!existsSync(specPath)) {
    fail('缺少 SPEC.md', 'SPEC 是 L1 基线，发布前必须存在');
  }

  const manifest = {
    name: 'dsh-steam',
    version,
    builtAt: new Date().toISOString(),
    tgz: tgzName,
    sha256: tgzSha,
    files: filesMeta,
    spec: {
      path: 'SPEC.md',
      sha256: sha256File(specPath),
    },
    tests,
    toolNames,
  };

  const out = join(dir, 'manifest.json');
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifestPath: out, manifest };
}

/** 只保留最近 3 个版本的 tgz；manifest 目录永久保留。 */
function pruneOldTgz(keepVersion) {
  const tgzFiles = readdirSync(ROOT)
    .filter((f) => /^dsh-steam-(\d+\.\d+\.\d+)\.tgz$/.test(f))
    .map((f) => {
      const version = f.match(/^dsh-steam-(\d+\.\d+\.\d+)\.tgz$/)[1];
      return { f, version, mtime: statSync(join(ROOT, f)).mtimeMs };
    })
    // 按 semver 降序，同版本按 mtime
    .sort((a, b) => compareSemver(b.version, a.version) || b.mtime - a.mtime);

  const keep = new Set();
  for (const item of tgzFiles) {
    if (keep.size >= 3) break;
    keep.add(item.f);
  }
  // 当前刚构建的版本一定保留
  keep.add(`dsh-steam-${keepVersion}.tgz`);

  for (const item of tgzFiles) {
    if (!keep.has(item.f)) {
      rmSync(join(ROOT, item.f), { force: true });
      console.log(`清理旧发布物：${item.f}`);
    }
  }
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function printSummary({ version, tgzName, tgzBytes, filesMeta, tgzSha, toolNames, elapsedMs }) {
  console.log('\n—— 发布摘要 ——');
  console.log(`版本：    ${version}`);
  console.log(`产物：    ${tgzName}（${(tgzBytes / 1024).toFixed(1)} KB，${filesMeta.length} 个文件）`);
  console.log(`sha256：  ${tgzSha.slice(0, 12)}…`);
  console.log(`工具：    ${toolNames.join(', ')}`);
  console.log(`自检耗时：${(elapsedMs / 1000).toFixed(2)} s`);
  console.log(`清单：    release/${version}/manifest.json`);
}

// ───────── main ─────────

function main() {
  console.log(`dsh-steam release · root=${ROOT}`);
  console.log(`node=${NODE}`);

  // 校验阶段：任何失败直接 exit(1)，此时尚未写入项目根 tgz / manifest
  const pkg = loadPackage();
  const { version, tgzName } = checkVersion(pkg);
  checkDependencies(pkg);
  console.log(`✓ 版本 ${version}，依赖为空`);

  checkSyntax();
  console.log(`✓ node --check lib/*.js`);

  const { toolNames, tests, elapsedMs } = checkSelftest();
  console.log(`✓ 自检通过，工具：${toolNames.join(', ')}`);

  scanLeaks();
  console.log('✓ 无本机路径 / 疑似密钥泄漏');

  // 构建阶段
  const { staging, pkgDir } = stagePackage();
  let built;
  try {
    built = buildTgz(version, tgzName, pkgDir, staging);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const { manifestPath } = writeManifest(
    version,
    tgzName,
    built.tgzSha,
    built.filesMeta,
    toolNames,
    tests,
  );

  pruneOldTgz(version);

  printSummary({
    version,
    tgzName,
    tgzBytes: built.tgzBytes,
    filesMeta: built.filesMeta,
    tgzSha: built.tgzSha,
    toolNames,
    elapsedMs,
  });
  console.log(`\n✅ 发布完成 → ${manifestPath}`);
}

try {
  main();
} catch (err) {
  // 未预期异常也走友好文案；不留下半成品的责任在各 fail()/finally
  console.error(`\n❌ 发布脚本异常：${err?.message ?? err}`);
  console.error('   怎么修：查看上方堆栈，修掉后重跑 node tools/release.mjs');
  if (err?.stack) console.error(err.stack);
  process.exit(1);
}
