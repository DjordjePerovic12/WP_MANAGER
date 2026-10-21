// Build the clean data set from cached raw data (no network).
// Usage: npm run data:build  → data/out/dataset.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSet, RealPlayer } from './model';
import { normalizeEuropeanAquatics } from './normalize';
import { readCache } from './http';
import { loadCachedEuropeanAquatics } from './sources/europeanaquatics';
import type { WaAthlete } from './sources/worldaquatics';

const OUT_DIR = join(import.meta.dirname, 'out');
const OVERRIDES = join(import.meta.dirname, 'overrides.json');

/** Hand corrections, keyed by player id, e.g. { "EA-P12183": { "position": "CENTER", "hand": "L" } } */
export function applyOverrides(data: DataSet, overrides: Record<string, Partial<RealPlayer>>) {
  for (const p of data.players) {
    const o = overrides[p.id];
    if (!o) continue;
    Object.assign(p, o);
    if (o.position) p.positionSource = 'official';
  }
}

/** Letters only, no accents, upper case: "Đukić" → "DUKIC" */
export const nameKey = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D').toUpperCase().replace(/[^A-Z]/g, '');

/** Fill in heights from World Aquatics, matching on nationality, date of birth and surname. */
export function enrichFromWorldAquatics(data: DataSet, athletesByNation: (nat: string) => WaAthlete[] | undefined) {
  let matched = 0;
  for (const p of data.players) {
    if (!p.nationality || !p.birthDate) continue;
    const candidates = athletesByNation(p.nationality)?.filter((a) => a.dateOfBirth === p.birthDate) ?? [];
    const last = nameKey(p.lastName);
    const match = candidates.find((a) => {
      const wa = nameKey(a.lastName);
      return wa === last || wa.startsWith(last) || last.startsWith(wa);
    });
    if (!match) continue;
    matched++;
    if (!p.heightCm && match.height && match.height > 150) p.heightCm = match.height;
  }
  return matched;
}

export function buildDataSet(): DataSet {
  const raw = loadCachedEuropeanAquatics();
  if (!raw) throw new Error('No cached data yet. Run `npm run data:fetch` first.');
  const data = normalizeEuropeanAquatics(raw);
  enrichFromWorldAquatics(data, (nat) => readCache<WaAthlete[]>('worldaquatics', `athletes-${nat}`));
  if (existsSync(OVERRIDES)) applyOverrides(data, JSON.parse(readFileSync(OVERRIDES, 'utf8')).players ?? {});
  return data;
}

if (import.meta.filename === process.argv[1]) {
  const data = buildDataSet();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'dataset.json'), JSON.stringify(data, null, 1));
  const count = (pos: string) => data.players.filter((p) => p.position === pos).length;
  console.log(`${data.competitions.length} competitions, ${data.clubs.length} clubs, ${data.players.length} players, ${data.matches.length} matches (${data.teamLines.length / 2} with stats)`);
  console.log(`positions: GK ${count('GK')}, CENTER ${count('CENTER')}, CDEF ${count('CDEF')}, DRIVER ${count('DRIVER')}, WING ${count('WING')}, POINT ${count('POINT')}; ${data.players.filter((p) => p.positionSource === 'default').length} without stats`);
  console.log(`heights known for ${data.players.filter((p) => p.heightCm).length} players`);
  console.log('→ data/out/dataset.json');
}
