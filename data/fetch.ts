// Download real data into data/cache/ (polite and cached).
// Usage: npm run data:fetch -- [--max-new N]

import { writeCache } from './http';
import { fetchEuropeanAquatics } from './sources/europeanaquatics';
import { fetchLogos } from './sources/logos';
import { fetchWaterPoloAthletes } from './sources/worldaquatics';
import { fetchMvlsz } from './sources/mvlsz';
import { fetchAsaMalta } from './sources/asamalta';
import { fetchHvs } from './sources/hvs';

const maxIdx = process.argv.indexOf('--max-new');
const maxNewMatches = maxIdx > 0 ? Number(process.argv[maxIdx + 1]) : undefined;

const ea = await fetchEuropeanAquatics({ maxNewMatches });
console.log(`teams ${ea.teams.length}, roster entries ${ea.rosters.length}, scheduled ${ea.schedule.length}, matches with stats ${Object.keys(ea.matches).length}`);

// Heights from World Aquatics, for every nationality in the men's rosters.
const nations = [...new Set(ea.rosters.filter((p) => p.PlaCatCode === 'ASM' && p.PlaNaz).map((p) => p.PlaNaz!))].sort();
let athletes = 0;
for (const nat of nations) {
  const list = await fetchWaterPoloAthletes(nat);
  writeCache('worldaquatics', `athletes-${nat}`, list);
  athletes += list.length;
}
console.log(`World Aquatics: ${athletes} athletes from ${nations.length} nationalities`);

// Club logos for the web page.
const menTeams = ea.teams.filter((t) => t.TeamCatCode === 'ASM').map((t) => t.TeamCode);
console.log(`Logos: ${await fetchLogos(menTeams)}/${menTeams.length} clubs`);

// Domestic leagues (cached; finished matches are never downloaded twice).
await fetchHvs();
await fetchMvlsz();
await fetchAsaMalta();
