/**
 * 回归：Windows 上注册表小写路径 vs libraryfolders.vdf 正常大小写，
 * 若按原串去重会把同一库扫两遍，条目数/体积翻倍。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listInstalledApps } from '../lib/steam-local.js';

test('library path case variants must dedupe to one library and one app', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-steam-dedupe-'));
  const steamapps = join(root, 'steamapps');
  await mkdir(steamapps, { recursive: true });

  // 同一物理目录的两种大小写写法（复现注册表 vs vdf 的差异）
  const mixedCase = root;
  const lowerCase = root.toLowerCase();

  const vdf = `"libraryfolders"
{
	"0"
	{
		"path"		"${mixedCase.replace(/\\/g, '\\\\')}"
	}
	"1"
	{
		"path"		"${lowerCase.replace(/\\/g, '\\\\')}"
	}
}
`;
  await writeFile(join(steamapps, 'libraryfolders.vdf'), vdf, 'utf8');

  const acf = `"AppState"
{
	"appid"		"730"
	"Universe"		"1"
	"name"		"Counter-Strike 2"
	"StateFlags"		"4"
	"installdir"		"Counter-Strike Global Offensive"
	"SizeOnDisk"		"2147483648"
	"BytesToDownload"		"0"
	"BytesDownloaded"		"0"
}
`;
  await writeFile(join(steamapps, 'appmanifest_730.acf'), acf, 'utf8');

  try {
    const { libraries, apps } = listInstalledApps(root);

    assert.equal(libraries.length, 1, `libraries 数量: ${libraries.length} (期望 1)`);
    assert.equal(apps.length, 1, `apps 数量: ${apps.length} (期望 1)`);
    assert.equal(apps[0]?.appid, 730);
    assert.equal(apps.filter((a) => a.appid === 730).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
