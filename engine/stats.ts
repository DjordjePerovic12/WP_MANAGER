// Box score: per-player and per-team statistics computed from match events.

import type { MatchEvent, MatchResult } from './types';

export interface PlayerStats {
  goals: number;
  shots: number;
  assists: number;
  exclusionsDrawn: number;
  personalFouls: number;
  brutalities: number;
  steals: number;
  blocks: number;
  saves: number;
  seconds: number;
}

export interface TeamStats {
  goals: number;
  shots: number;
  saves: number;
  exclusionsDrawn: number;
  powerPlayGoals: number;
  powerPlayShots: number;
  penaltiesAwarded: number;
  penaltyGoals: number;
  counterGoals: number;
  turnovers: number;
  timeouts: number;
  brutalitiesDrawn: number;
}

const emptyPlayer = (): PlayerStats => ({ goals: 0, shots: 0, assists: 0, exclusionsDrawn: 0, personalFouls: 0, brutalities: 0, steals: 0, blocks: 0, saves: 0, seconds: 0 });
const emptyTeam = (): TeamStats => ({
  goals: 0, shots: 0, saves: 0, exclusionsDrawn: 0, powerPlayGoals: 0, powerPlayShots: 0,
  penaltiesAwarded: 0, penaltyGoals: 0, counterGoals: 0, turnovers: 0, timeouts: 0, brutalitiesDrawn: 0,
});

const SHOTS = new Set<MatchEvent['type']>(['goal', 'save', 'miss', 'block']);

export function boxScore(result: MatchResult) {
  const players: Record<string, PlayerStats> = {};
  const p = (id: string) => (players[id] ??= emptyPlayer());
  for (const team of result.teams) for (const pl of team.players) p(pl.id).seconds = result.secondsPlayed[pl.id] ?? 0;
  const teams: [TeamStats, TeamStats] = [emptyTeam(), emptyTeam()];

  for (const e of result.events) {
    if (e.situation === 'shootout') continue;
    const t = teams[e.team];
    const d = teams[1 - e.team];
    if (SHOTS.has(e.type) && e.player) {
      t.shots++;
      p(e.player).shots++;
      if (e.situation === 'powerplay') t.powerPlayShots++;
    }
    switch (e.type) {
      case 'goal':
        t.goals++;
        p(e.player!).goals++;
        if (e.assist) p(e.assist).assists++;
        if (e.situation === 'powerplay') t.powerPlayGoals++;
        if (e.situation === 'penalty') t.penaltyGoals++;
        if (e.situation === 'counter') t.counterGoals++;
        break;
      case 'save':
        d.saves++;
        p(e.other!).saves++;
        break;
      case 'block':
        p(e.other!).blocks++;
        break;
      case 'exclusion':
        t.exclusionsDrawn++;
        p(e.player!).exclusionsDrawn++;
        p(e.other!).personalFouls++;
        break;
      case 'penalty_awarded':
        t.penaltiesAwarded++;
        p(e.other!).personalFouls++;
        break;
      case 'turnover':
      case 'offensive_foul':
      case 'shot_clock':
        t.turnovers++;
        if (e.type === 'turnover' && e.other) p(e.other).steals++;
        break;
      case 'brutality':
        t.brutalitiesDrawn++;
        p(e.other!).brutalities++;
        break;
      case 'timeout':
        t.timeouts++;
        break;
    }
  }
  return { teams, players };
}
