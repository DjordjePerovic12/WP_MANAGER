// Print the best-rated players per position and the strongest squads, for an expert sanity check.
// Usage: npm run ratings:report -- [players per position]

import { overall, teamRating } from '../engine/ratings';
import { buildDataSet } from './build';
import { isPlayable, positionsOrder, ratePlayers, toEngineTeams } from './ratings';

const top = Number(process.argv[2] ?? 8);
const data = buildDataSet();
const rated = ratePlayers(data);
const clubName = new Map(data.clubs.map((c) => [c.id, c.shortName]));

for (const pos of positionsOrder) {
  console.log(`\n${pos}`);
  const best = rated.filter((p) => p.position === pos).sort((a, b) => overall(b) - overall(a)).slice(0, top);
  for (const p of best) {
    const a = p.attrs;
    const key = pos === 'GK' ? `ref ${a.reflexes} pos ${a.gkPositioning}` : `spd ${a.speed} pow ${a.shootingPower} acc ${a.shootingAccuracy} pas ${a.passing} wre ${a.wrestling} leg ${a.legStrength} def ${a.positioning} iq ${a.gameIQ}`;
    console.log(`  ${overall(p).toFixed(1).padStart(4)}  ${p.name.padEnd(30)} ${String(clubName.get(p.clubId)).padEnd(26)} age ${p.age}  ${p.games} games  ${key}`);
  }
}

const teams = toEngineTeams(data, rated).filter(isPlayable).sort((a, b) => teamRating(b.players) - teamRating(a.players));
console.log('\nStrongest squads');
for (const t of teams.slice(0, 15)) console.log(`  ${teamRating(t.players).toFixed(1)}  ${t.name}`);
console.log(`\n${teams.length} playable squads (of ${data.clubs.length} clubs). Hands are guessed for all players until set in data/overrides.json.`);
