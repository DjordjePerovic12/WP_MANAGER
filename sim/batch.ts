// Simulate many matches and report statistics to judge the engine's realism.
import { pathToFileURL } from 'node:url';
// Usage: npm run batch -- [matches]

import { boxScore, generateLeague, overall, simulateMatch, teamRating } from '../engine';

export function runBatch(matches: number, seed = 1) {
  const league = generateLeague(seed);
  const ratings = league.map((t) => teamRating(t.players));
  const totals = {
    goals: 0, shots: 0, saves: 0, exclusions: 0, ppGoals: 0, penalties: 0, penaltyGoals: 0,
    counterGoals: 0, turnovers: 0, draws: 0, fouledOut: 0, timeouts: 0,
    favouriteGames: 0, favouriteWins: 0, maxSeconds: 0, starSeconds: 0, tacticChanges: 0,
    closeGames: 0, closeDraws: 0,
  };
  const margins = new Map<number, number>();
  const teamGoals = new Map<number, number>();

  for (let i = 0; i < matches; i++) {
    const a = i % league.length;
    const b = (a + 1 + Math.floor(i / league.length)) % league.length;
    if (a === b) continue;
    const result = simulateMatch(league[a], league[b], { seed: seed * 100003 + i });
    const box = boxScore(result);
    for (const t of box.teams) {
      totals.goals += t.goals;
      totals.shots += t.shots;
      totals.saves += t.saves;
      totals.exclusions += t.exclusionsDrawn;
      totals.ppGoals += t.powerPlayGoals;
      totals.penalties += t.penaltiesAwarded;
      totals.penaltyGoals += t.penaltyGoals;
      totals.counterGoals += t.counterGoals;
      totals.turnovers += t.turnovers;
      totals.timeouts += t.timeouts;
      teamGoals.set(t.goals, (teamGoals.get(t.goals) ?? 0) + 1);
    }
    totals.fouledOut += result.events.filter((e) => e.type === 'fouled_out').length;
    const fieldPlayers = result.teams.flatMap((t) => t.players.filter((p) => p.position !== 'GK'));
    totals.maxSeconds += Math.max(...fieldPlayers.map((p) => result.secondsPlayed[p.id]));
    for (const team of result.teams) {
      const star = team.players.filter((p) => p.position !== 'GK').reduce((x, y) => (overall(y) > overall(x) ? y : x));
      totals.starSeconds += result.secondsPlayed[star.id];
    }
    totals.tacticChanges += result.events.filter((e) => e.type === 'tactics').length;
    const [ga, gb] = result.score;
    if (ga === gb) totals.draws++;
    if (Math.abs(ratings[a] - ratings[b]) < 1) {
      totals.closeGames++;
      if (ga === gb) totals.closeDraws++;
    }
    margins.set(Math.abs(ga - gb), (margins.get(Math.abs(ga - gb)) ?? 0) + 1);
    if (Math.abs(ratings[a] - ratings[b]) >= 2 && ga !== gb) {
      totals.favouriteGames++;
      if ((ratings[a] > ratings[b]) === (ga > gb)) totals.favouriteWins++;
    }
  }
  const teamGames = matches * 2;
  return {
    goalsPerTeam: totals.goals / teamGames,
    shotsPerTeam: totals.shots / teamGames,
    shootingPct: totals.goals / totals.shots,
    savePct: totals.saves / (totals.saves + totals.goals),
    exclusionsPerTeam: totals.exclusions / teamGames,
    powerPlayPct: totals.ppGoals / totals.exclusions,
    penaltiesPerGame: totals.penalties / matches,
    penaltyPct: totals.penaltyGoals / totals.penalties,
    counterGoalsPerTeam: totals.counterGoals / teamGames,
    turnoversPerTeam: totals.turnovers / teamGames,
    fouledOutPerGame: totals.fouledOut / matches,
    timeoutsPerTeam: totals.timeouts / teamGames,
    drawPct: totals.draws / matches,
    closeDrawPct: totals.closeDraws / Math.max(1, totals.closeGames),
    favouriteWinPct: totals.favouriteWins / Math.max(1, totals.favouriteGames),
    busiestPlayerMinutes: totals.maxSeconds / matches / 60,
    starMinutes: totals.starSeconds / teamGames / 60,
    tacticChangesPerTeam: totals.tacticChanges / teamGames,
    margins,
    teamGoals,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const matches = Number(process.argv[2] ?? 2000);
  const s = runBatch(matches);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const row = (label: string, value: string, target: string) => console.log(`${label.padEnd(28)} ${value.padStart(8)}   (real: ${target})`);
  console.log(`Simulated ${matches} matches. "real" = 2026-27 European club matches (npm run data:report)\n`);
  row('Goals per team', s.goalsPerTeam.toFixed(1), '13.8');
  row('Shots per team', s.shotsPerTeam.toFixed(1), '27.9');
  row('Shooting %', pct(s.shootingPct), '49.5%');
  row('Save %', pct(s.savePct), '37.1%');
  row('Exclusions drawn per team', s.exclusionsPerTeam.toFixed(1), '12.3');
  row('6v5 goals per exclusion', pct(s.powerPlayPct), '33.2%');
  row('Penalties per game', s.penaltiesPerGame.toFixed(2), '3.74');
  row('Penalty conversion', pct(s.penaltyPct), '80.2%');
  row('Counter goals per team', s.counterGoalsPerTeam.toFixed(1), '0.9');
  row('Turnovers per team', s.turnoversPerTeam.toFixed(1), 'not comparable');
  row('Fouled out per game', s.fouledOutPerGame.toFixed(2), '3.6');
  row('Timeouts per team', s.timeoutsPerTeam.toFixed(2), '~1–2');
  row('Draw %', pct(s.drawPct), '~8–12%');
  row('Favourite wins (Δrating≥2)', pct(s.favouriteWinPct), '~75–90%');
  row('Busiest field player (min)', s.busiestPlayerMinutes.toFixed(1), '~24–30');
  console.log('');
  row('Draw % (Δrating<1)', pct(s.closeDrawPct), 'higher than overall');
  row("Each team's best field player (min)", s.starMinutes.toFixed(1), '~24–30');
  row('AI tactic changes per team', s.tacticChangesPerTeam.toFixed(2), '—');

  console.log('\nWinning margin distribution:');
  for (const [m, n] of [...s.margins].sort((a, b) => a[0] - b[0])) console.log(`  ${String(m).padStart(2)}  ${'█'.repeat(Math.round((n / matches) * 100))} ${pct(n / matches)}`);
  console.log('\nGoals per team distribution:');
  for (const [g, n] of [...s.teamGoals].sort((a, b) => a[0] - b[0])) console.log(`  ${String(g).padStart(2)}  ${'█'.repeat(Math.round((n / (matches * 2)) * 150))} ${pct(n / (matches * 2))}`);
}
