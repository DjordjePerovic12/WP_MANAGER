// Real-world match statistics computed from the data set: the targets the
// match engine is calibrated against.

import type { DataSet } from './model';

export interface RealStats {
  matches: number;
  goalsPerTeam: number;
  shotsPerTeam: number;
  shootingPct: number;
  savePct: number;
  exclusionsDrawnPerTeam: number;
  powerPlayPct: number;
  powerPlayShotsPerTeam: number;
  penaltiesPerGame: number;
  penaltyPct: number;
  counterGoalsPerTeam: number;
  centerGoalsPerTeam: number;
  turnoversPerTeam: number;
  drawPct: number;
  averageMargin: number;
}

export function computeRealStats(data: DataSet): RealStats {
  const t = data.teamLines;
  const n = t.length;
  const sum = (f: (x: (typeof t)[number]) => number) => t.reduce((s, x) => s + f(x), 0);
  const byClubMatch = new Map(t.map((x) => [`${x.matchId}|${x.clubId}`, x]));
  const exclusionsDrawn = sum((x) => byClubMatch.get(`${x.matchId}|${x.opponentId}`)?.exclusionsCommitted ?? 0);
  const penaltiesAwarded = sum((x) => x.shots.penalty[1]);
  const played = data.matches.filter((m) => t.some((x) => x.matchId === m.id));
  return {
    matches: played.length,
    goalsPerTeam: sum((x) => x.goals) / n,
    shotsPerTeam: sum((x) => x.shots.total[1]) / n,
    shootingPct: sum((x) => x.goals) / sum((x) => x.shots.total[1]),
    savePct: sum((x) => x.saves) / (sum((x) => x.saves) + sum((x) => x.goals - x.shots.penalty[0])),
    exclusionsDrawnPerTeam: exclusionsDrawn / n,
    // Conversion per exclusion drawn (not per shot): what the engine reports.
    powerPlayPct: sum((x) => x.shots.extra[0]) / exclusionsDrawn,
    powerPlayShotsPerTeam: sum((x) => x.shots.extra[1]) / n,
    penaltiesPerGame: penaltiesAwarded / played.length,
    penaltyPct: sum((x) => x.shots.penalty[0]) / penaltiesAwarded,
    counterGoalsPerTeam: sum((x) => x.shots.counter[0]) / n,
    centerGoalsPerTeam: sum((x) => x.shots.center[0]) / n,
    turnoversPerTeam: sum((x) => x.turnovers) / n,
    drawPct: played.filter((m) => m.score[0] === m.score[1]).length / played.length,
    averageMargin: played.reduce((s, m) => s + Math.abs(m.score[0] - m.score[1]), 0) / played.length,
  };
}
