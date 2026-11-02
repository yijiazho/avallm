// The server's single persistent-data root.
//
// Runtime state that must survive a redeploy (user agents today, finished-game
// archives next) lives under one directory. The composition root resolves that
// root once from the environment after .env has loaded; every consumer reads
// the same value, so a boot scan and a later write can never disagree about
// where the volume is mounted.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_DATA_DIR = path.join(__dirname, '..', 'data')

let dataDirBase: string | undefined

// Pure resolver: the caller passes the environment, so tests never depend on a
// developer's ambient AVALON_*/RAILWAY_* variables. AVALON_DATA_DIR wins; an
// empty or whitespace-only value counts as unset (an empty Railway variable is
// common and would otherwise turn the repo-local fallback into the filesystem
// root).
export function resolveDataDirBase(env: NodeJS.ProcessEnv): string | undefined {
  const avalon = env.AVALON_DATA_DIR?.trim()
  if (avalon) return avalon
  const railway = env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
  return railway || undefined
}

// Point every data consumer under `base`. Called once at startup; an
// undefined/empty base keeps the repo-local default.
export function useDataDirBase(base: string | undefined): void {
  dataDirBase = base?.trim() || undefined
}

export function dataDir(): string {
  return dataDirBase ?? REPO_DATA_DIR
}

export function userAgentsDir(): string {
  return path.join(dataDir(), 'agents')
}

export function gamesDir(): string {
  return path.join(dataDir(), 'games')
}
