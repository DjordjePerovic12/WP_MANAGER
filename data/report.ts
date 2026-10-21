// Print real-world statistics from the data set.  Usage: npm run data:report
import { buildDataSet } from './build';
import { computeRealStats } from './realstats';

const s = computeRealStats(buildDataSet());
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Real men's European club matches, 2026-27 season so far (${s.matches} matches)\n`);
for (const [label, value] of [
  ['Goals per team', s.goalsPerTeam.toFixed(1)],
  ['Shots per team', s.shotsPerTeam.toFixed(1)],
  ['Shooting %', pct(s.shootingPct)],
  ['Save % (excl. penalties)', pct(s.savePct)],
  ['Exclusions drawn per team', s.exclusionsDrawnPerTeam.toFixed(1)],
  ['6v5 shots per team', s.powerPlayShotsPerTeam.toFixed(1)],
  ['6v5 goals per exclusion', pct(s.powerPlayPct)],
  ['Penalties per game', s.penaltiesPerGame.toFixed(2)],
  ['Penalty conversion', pct(s.penaltyPct)],
  ['Counter goals per team', s.counterGoalsPerTeam.toFixed(1)],
  ['Center goals per team', s.centerGoalsPerTeam.toFixed(1)],
  ['Turnovers per team', s.turnoversPerTeam.toFixed(1)],
  ['Draw %', pct(s.drawPct)],
  ['Average winning margin', s.averageMargin.toFixed(1)],
]) console.log(`${label.padEnd(28)} ${value.padStart(7)}`);
