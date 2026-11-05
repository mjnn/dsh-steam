# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.1] - 2026-11-05

### Added
- `tools/release.mjs` Git 一致性闸门：发布前要求工作区干净且 HEAD 已打 `v<version>` tag（`ALLOW_UNTAGGED=1` 可跳过 tag 检查）

### Changed
- 发布顺序固定为：commit → `git tag -a vX.Y.Z` → `node tools/release.mjs` → npm publish → GitHub Release

## [0.9.0] - 2026-11-05

### Added
- `tools/release.mjs` packed-artifact smoke gate: extract the tgz, import `lib/index.js`, assert exports/`apply` registers 21 tools, and check `files` / `lib/*.js` completeness before writing the manifest

## [0.8.1] - 2026-11-05

### Fixed
- Unified steamid resolution for all Key tools (`library` / `friends` / `achievements` / `wishlist` / `recent` / `level`) via `resolveSteamid()` — local `loginusers.vdf` MostRecent=1 fallback is no longer limited to recent/level.

### Added
- Operations handbook: `aidlc-docs/operations/operations.md`
- This changelog

## [0.8.0] - 2026-11-05

### Added
- `steam_recent` — recently played games (requires API Key)
- `steam_level` — Steam level, XP, and badges (requires API Key)
- Local steamid helper reading `loginusers.vdf`

## [0.7.0] - 2026-11-05

### Added
- `steam_media` — screenshot / trailer URLs (no download)
- `steam_dlc` — DLC list with capped price lookups
- `steam_achievement_schema` — achievement name schema (requires API Key)

## [0.6.0] - 2026-11-05

### Added
- `steam_players` — current player count
- `steam_achievements_global` — global achievement rates (ascending)
- `steam_open` — whitelisted `steam://` launcher
- `steam_friends` / `steam_achievements` / `steam_wishlist` (require API Key)

## [0.5.0] - 2026-11-05

### Added
- `steam_specs` — PC requirements (HTML stripped)
- `steam_news` — news / patch notes
- `steam_price_history` — local observed price history

## [0.4.0] - 2026-11-05

### Added
- `steam_deals` — featured specials / top sellers / new releases

### Fixed
- `progressPercent` is `null` when not downloading (no longer reports 100%)

## [0.3.0] - 2026-11-05

### Changed
- Spec-driven rewrite: layered modules, safer errors, Chinese comments
- Release script + material governance (`aidlc-docs/`, `tools/release.mjs`)

### Fixed
- Library path case-insensitive dedupe (registry vs VDF) — stopped double-counting installs
- Appid dedupe across libraries
- Regression test `test/dedupe.test.mjs`

## [0.2.0] - 2026-11-05

### Fixed
- DSH plugin contract: flat `parameters`, `inject = ['tools']`
- Tool registration and selftest green path

## [0.1.0] - 2026-11-05

### Added
- Initial six tools: `steam_price`, `steam_search`, `steam_watch`, `steam_download_status`, `steam_install`, `steam_library`
