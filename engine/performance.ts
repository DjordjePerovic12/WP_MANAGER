// Player ratings out of 10 for one match, built from what each player did in it:
// goals, assists, exclusions and penalties won, steals, blocks, sprints, saves...
// minus misses, turnovers and fouls. A typical solid game is about 6.5; a hat-trick
// with a few exclusions won is 8+. Players with under two minutes get no rating.

import type { MatchEvent, MatchResult } from './types';

const BASE = 6.0;
const MIN_SECONDS = 120;
const SOFT = 3.4;

/** What each event is worth to the main actor (`player`) and the second actor (`other`). */
function credit(e: MatchEvent): { player?: number; other?: number; assist?: number } {
  switch (e.type) {
    case 'goal':
      // The keeper conceding is judged by his save rate below; here only a small share.
      return { player: e.situation === 'penalty' ? 0.35 : e.situation === 'powerplay' ? 0.45 : 0.55, other: -0.1, assist: 0.3 };
    case 'save':
      return { player: -0.1, other: e.situation === 'penalty' ? 0.5 : 0.25 };
    case 'block':
      return { player: -0.1, other: 0.25 };
    case 'miss':
      return { player: -0.12 };
    case 'sprint':
      return { player: 0.15 };
    case 'turnover':
      return { player: -0.15, other: 0.3 };
    case 'offensive_foul':
      return { player: -0.15, other: 0.15 };
    case 'exclusion':
      return { player: 0.25, other: -0.2 };
    case 'penalty_awarded':
      return { player: 0.35, other: -0.35 };
    case 'fouled_out':
      return { player: -0.3 };
    case 'brutality':
      return { player: 0.2, other: -1.2 };
    default:
      return {};
  }
}

export interface MatchRatings {
  /** rating out of 10 per player who played at least two minutes */
  ratings: Record<string, number>;
  /** the best rating in the match (preferring the winning side when level) */
  manOfTheMatch?: string;
}

export function matchRatings(result: MatchResult): MatchRatings {
  const score = new Map<string, number>();
  const add = (id: string | undefined, v: number | undefined) => {
    if (id && v) score.set(id, (score.get(id) ?? 0) + v);
  };
  for (const e of result.events) {
    if (e.situation === 'shootout') continue;
    const c = credit(e);
    add(e.player, c.player);
    add(e.other, c.other);
    add(e.assist, c.assist);
  }
  // Winning or losing colours everyone's evening a little, in proportion to time in the water.
  const [h, a] = result.score;
  const so = result.shootout;
  const homeWon = h > a || (h === a && !!so && so[0] > so[1]);
  const awayWon = a > h || (h === a && !!so && so[1] > so[0]);
  const ratings: Record<string, number> = {};
  result.teams.forEach((team, side) => {
    const won = side === 0 ? homeWon : awayWon;
    const lost = side === 0 ? awayWon : homeWon;
    const margin = Math.abs(h - a);
    for (const p of team.players) {
      const seconds = result.secondsPlayed[p.id] ?? 0;
      if (seconds < MIN_SECONDS) continue;
      const share = Math.min(1, seconds / (32 * 60 * 0.75));
      const outcome = (won ? 0.3 + Math.min(margin, 6) * 0.03 : lost ? -0.25 - Math.min(margin, 6) * 0.03 : 0) * share;
      // Big nights count, but each extra goal adds a little less: 10 is for something special.
      const raw = (score.get(p.id) ?? 0) + outcome;
      const v = BASE + (raw > 0 ? SOFT * Math.tanh(raw / SOFT) : raw);
      ratings[p.id] = Math.round(Math.max(3, Math.min(10, v)) * 10) / 10;
    }
  });
  const winners = new Set((homeWon ? result.teams[0] : awayWon ? result.teams[1] : { players: [] }).players.map((p) => p.id));
  const manOfTheMatch = Object.entries(ratings).sort((x, y) => y[1] - x[1] || Number(winners.has(y[0])) - Number(winners.has(x[0])))[0]?.[0];
  return { ratings, manOfTheMatch };
}
