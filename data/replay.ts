// Replay every real match with the real squads and compare with what actually happened.
// Usage: npm run data:replay -- [simulations per match]

import { simulateMatch } from '../engine/match';
import { boxScore } from '../engine/stats';
import { buildDataSet } from './build';
import { computeRealStats } from './realstats';
import { isPlayable, toEngineTeams } from './ratings';

const runs = Number(process.argv[2] ?? 200);
const data = buildDataSet();
const teams = new Map(toEngineTeams(data).filter(isPlayable).map((t) => [t.id, t]));
const real = computeRealStats(data);

let replayed = 0, correctWinner = 0, goals = 0, exclusions = 0, ppGoals = 0, penalties = 0, teamGames = 0, marginErr = 0;
const rows: string[] = [];
for (const m of data.matches) {
  const home = teams.get(m.homeId), away = teams.get(m.awayId);
  if (!home || !away) continue;
  replayed++;
  let homeWins = 0, totalMargin = 0;
  for (let i = 0; i < runs; i++) {
    const r = simulateMatch(home, away, { seed: i + 1, shootoutOnDraw: true });
    const box = boxScore(r);
    const homeWon = r.score[0] > r.score[1] || (r.score[0] === r.score[1] && (r.shootout?.[0] ?? 0) > (r.shootout?.[1] ?? 0));
    if (homeWon) homeWins++;
    totalMargin += r.score[0] - r.score[1];
    for (const t of box.teams) {
      goals += t.goals; exclusions += t.exclusionsDrawn; ppGoals += t.powerPlayGoals; penalties += t.penaltiesAwarded; teamGames++;
    }
  }
  const pHome = homeWins / runs;
  const realHomeWon = m.score[0] > m.score[1];
  if ((pHome >= 0.5) === realHomeWon) correctWinner++;
  marginErr += Math.abs(totalMargin / runs - (m.score[0] - m.score[1]));
  rows.push(`  ${m.date}  ${home.name.padEnd(26)} ${String(m.score[0]).padStart(2)}–${String(m.score[1]).padEnd(2)} ${away.name.padEnd(26)} engine: home wins ${(pHome * 100).toFixed(0).padStart(3)}%, avg margin ${(totalMargin / runs).toFixed(1)}`);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Replayed ${replayed} real matches × ${runs} simulations\n`);
console.log(rows.join('\n'));
console.log(`\nEngine picked the real winner in ${correctWinner}/${replayed} (${pct(correctWinner / replayed)})`);
console.log(`Average error in winning margin: ${(marginErr / replayed).toFixed(1)} goals\n`);
console.log('                           engine    real');
console.log(`Goals per team             ${(goals / teamGames).toFixed(1).padStart(6)}  ${real.goalsPerTeam.toFixed(1).padStart(6)}`);
console.log(`Exclusions drawn per team  ${(exclusions / teamGames).toFixed(1).padStart(6)}  ${real.exclusionsDrawnPerTeam.toFixed(1).padStart(6)}`);
console.log(`6v5 goals per exclusion    ${pct(ppGoals / exclusions).padStart(6)}  ${pct(real.powerPlayPct).padStart(6)}`);
console.log(`Penalties per game         ${((penalties / teamGames) * 2).toFixed(2).padStart(6)}  ${real.penaltiesPerGame.toFixed(2).padStart(6)}`);
