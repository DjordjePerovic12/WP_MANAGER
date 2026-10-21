// Play one match and print the commentary and box score.
// Usage: npm run play -- [seed]

import { boxScore, commentary, formatClock, generateLeague, simulateMatch, teamRating } from '../engine';

const seed = Number(process.argv[2] ?? Math.floor(Math.random() * 1e9));
const league = generateLeague(seed);
const [home, away] = [league[0], league[1]];
const result = simulateMatch(home, away, { seed, shootoutOnDraw: true });

console.log(`${home.name} (rating ${teamRating(home.players).toFixed(1)}) vs ${away.name} (rating ${teamRating(away.players).toFixed(1)})  seed ${seed}\n`);
for (const line of commentary(result)) {
  const prefix = line.event.type.startsWith('quarter') || line.event.type === 'full_time' ? '' : `Q${line.quarter} ${line.clock.padStart(5)}  `;
  console.log(prefix + line.text);
}

const box = boxScore(result);
console.log(`\nBy quarter: ${result.quarterScores.map(([a, b]) => `${a}–${b}`).join(', ')}`);
for (const [i, team] of result.teams.entries()) {
  const t = box.teams[i];
  console.log(`\n${team.name}: ${t.goals} goals from ${t.shots} shots | 6v5 ${t.powerPlayGoals}/${t.exclusionsDrawn} | penalties ${t.penaltyGoals}/${t.penaltiesAwarded} | counter goals ${t.counterGoals} | turnovers ${t.turnovers} | saves ${t.saves}`);
  console.log('  #  Name                     Pos     Min  G  Sh  A  ExD PF  St  Sv');
  for (const p of team.players) {
    const s = box.players[p.id];
    console.log(
      `  ${String(p.cap).padStart(2)} ${p.name.padEnd(24)} ${p.position.padEnd(6)} ${formatClock(Math.round(s.seconds)).padStart(5)} ${String(s.goals).padStart(2)} ${String(s.shots).padStart(3)} ${String(s.assists).padStart(2)} ${String(s.exclusionsDrawn).padStart(4)} ${String(s.personalFouls).padStart(2)} ${String(s.steals).padStart(3)} ${String(s.saves).padStart(3)}`,
    );
  }
}
