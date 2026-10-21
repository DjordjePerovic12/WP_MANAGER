// Turn real players and their stats into game players with 1–20 attributes.
//
// Every player starts from their club's strength (competition level + results),
// then each attribute moves up or down depending on how the player's real stats
// rank against everyone else in the data set (percentiles), plus an age curve.
// Stats are "shrunk" toward the average when a player has few games, so one
// lucky match doesn't make a star.

import type { Attributes, Player, Position, Team } from '../engine/types';
import { DEFAULT_TACTICS } from '../engine/generate';
import { POSITION_WEIGHTS } from '../engine/ratings';
import type { DataSet, PlayerMatchLine, RealPlayer } from './model';

const TIER_BASE: Record<number, number> = { 1: 13.5, 2: 11.5, 3: 10, 4: 9 };
const STAT_SWING = 6;         // a player at the top percentile gets +3, the bottom −3
const MIN_GAMES_FOR_STATS = 1;

export interface RatedPlayer extends Player {
  realId: string;
  clubId: string;
  /** true when the hand is a guess (the sources don't publish handedness) */
  handGuessed: boolean;
  games: number;
}

/** Deterministic pseudo-random number in [0, 1) from a string, so ratings don't change between runs. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Percentile rank of value within a sorted array (0..1). */
function percentile(sorted: number[], value: number) {
  if (sorted.length < 2) return 0.5;
  let lo = 0;
  while (lo < sorted.length && sorted[lo] < value) lo++;
  let hi = lo;
  while (hi < sorted.length && sorted[hi] === value) hi++;
  return (lo + hi) / 2 / sorted.length;
}

export function ageOn(birthDate: string | undefined, onDate = '2026-10-01') {
  if (!birthDate) return 26;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Club strength on the 1–20 scale from its best competition and its results this season. */
export function clubStrengths(data: DataSet): Map<string, number> {
  const tierOf = new Map(data.competitions.map((c) => [c.id, c.tier]));
  const diff = new Map<string, { gd: number; n: number }>();
  for (const m of data.matches) {
    for (const [club, sign] of [[m.homeId, 1], [m.awayId, -1]] as const) {
      const d = diff.get(club) ?? { gd: 0, n: 0 };
      d.gd += sign * (m.score[0] - m.score[1]);
      d.n++;
      diff.set(club, d);
    }
  }
  const out = new Map<string, number>();
  for (const club of data.clubs) {
    const tier = Math.min(...club.competitions.map((c) => tierOf.get(c) ?? 4));
    const d = diff.get(club.id);
    const form = d && d.n ? clamp(d.gd / d.n / 4, -1.5, 1.5) : 0;
    out.set(club.id, (TIER_BASE[tier] ?? 9) + form);
  }
  return out;
}

interface Aggregate {
  games: number;
  goals: number;
  attempts: number;
  centerGoals: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  sprintsWon: number;
  sprints: number;
  counterAttempts: number;
  centerExclusions: number;
  saves: number;
  faced: number;
}

function aggregate(data: DataSet) {
  const agg = new Map<string, Aggregate>();
  const get = (id: string) => {
    let a = agg.get(id);
    if (!a) agg.set(id, (a = { games: 0, goals: 0, attempts: 0, centerGoals: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, sprintsWon: 0, sprints: 0, counterAttempts: 0, centerExclusions: 0, saves: 0, faced: 0 }));
    return a;
  };
  for (const l of data.playerLines as PlayerMatchLine[]) {
    const a = get(l.playerId);
    a.games++;
    a.goals += l.shots.total[0];
    a.attempts += l.shots.total[1];
    a.centerGoals += l.shots.center[0];
    a.assists += l.assists;
    a.steals += l.steals;
    a.blocks += l.blocks;
    a.turnovers += l.turnovers;
    a.sprintsWon += l.sprints[0];
    a.sprints += l.sprints[1];
    a.counterAttempts += l.shots.counter[1];
    a.centerExclusions += l.exclusionsCenter;
  }
  for (const g of data.goalkeeperLines) {
    const a = get(g.playerId);
    a.saves += g.saves;
    a.faced += g.shotsFaced;
  }
  return agg;
}

/** Stat-derived signals per player (shrunk toward the average for small samples). */
function signals(a: Aggregate) {
  const g = a.games;
  return {
    accuracy: (a.goals + 2) / (a.attempts + 5),
    scoring: a.goals / (g + 1),
    passing: a.assists / (g + 1),
    defending: (a.steals + a.blocks) / (g + 1),
    care: (a.goals + a.assists + 1) / (a.turnovers + 1) / (g + 1),
    speed: (a.sprintsWon + a.counterAttempts) / (g + 1),
    physical: (a.centerGoals + a.centerExclusions * 0.5) / (g + 1),
    keeping: (a.saves + 4) / (a.faced + 10),
  };
}
type SignalName = keyof ReturnType<typeof signals>;

/** Which attributes each signal moves, and how strongly. */
const SIGNAL_EFFECTS: Record<SignalName, Partial<Record<keyof Attributes, number>>> = {
  accuracy: { shootingAccuracy: 1 },
  scoring: { shootingPower: 1, gameIQ: 0.3 },
  passing: { passing: 1, gameIQ: 0.4 },
  defending: { positioning: 1 },
  care: { gameIQ: 0.6 },
  speed: { speed: 1, stamina: 0.3 },
  physical: { wrestling: 0.8, legStrength: 0.6 },
  keeping: { reflexes: 1, gkPositioning: 0.8 },
};

export function ratePlayers(data: DataSet): RatedPlayer[] {
  const strength = clubStrengths(data);
  const agg = aggregate(data);

  // Percentile tables, separately for goalkeepers and field players.
  const isGk = (p: RealPlayer) => p.position === 'GK';
  const byId = new Map(data.players.map((p) => [p.id, p]));
  const tables = new Map<string, number[]>();
  for (const [id, a] of agg) {
    const p = byId.get(id);
    if (!p || a.games < MIN_GAMES_FOR_STATS) continue;
    for (const [name, value] of Object.entries(signals(a))) {
      const key = `${isGk(p) ? 'gk' : 'field'}:${name}`;
      tables.set(key, [...(tables.get(key) ?? []), value]);
    }
  }
  for (const t of tables.values()) t.sort((x, y) => x - y);

  return data.players.map((p) => {
    const a = agg.get(p.id);
    const age = ageOn(p.birthDate);
    const base = (strength.get(p.clubId) ?? 9) + (a ? 0 : -1); // unused squad players start a little lower
    const weights = POSITION_WEIGHTS[p.position];
    const attrs = {} as Attributes;
    const deltas: Partial<Record<keyof Attributes, number>> = {};

    if (a && a.games >= MIN_GAMES_FOR_STATS) {
      for (const [name, value] of Object.entries(signals(a)) as [SignalName, number][]) {
        if (isGk(p) !== (name === 'keeping')) continue;
        const pct = percentile(tables.get(`${isGk(p) ? 'gk' : 'field'}:${name}`) ?? [], value);
        // More games → more trust in the stats.
        const trust = Math.min(1, a.games / 4);
        for (const [attr, w] of Object.entries(SIGNAL_EFFECTS[name]) as [keyof Attributes, number][]) {
          deltas[attr] = (deltas[attr] ?? 0) + (pct - 0.5) * STAT_SWING * w * trust;
        }
      }
    }

    const keys: (keyof Attributes)[] = ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ', 'reflexes', 'gkPositioning'];
    for (const key of keys) {
      let v = base + (deltas[key] ?? 0);
      if (weights[key]) v += 1.2;
      // Age curve: peak 25–30.
      if (key === 'speed' || key === 'stamina') v += age < 21 ? 0.5 : age > 32 ? -1.5 : age > 30 ? -0.7 : 0;
      if (key === 'gameIQ' || key === 'positioning') v += age < 21 ? -1.5 : age < 24 ? -0.6 : age > 29 ? 0.6 : 0;
      if (key !== 'gameIQ' && age < 20) v -= 0.8;
      // Height helps at 2m and in goal.
      if (p.heightCm && (key === 'wrestling' || key === 'legStrength' || key === 'gkPositioning')) v += clamp((p.heightCm - 192) / 6, -1.5, 1.5);
      // Goalkeepers are poor field players and vice versa.
      if (p.position === 'GK' && !['reflexes', 'gkPositioning', 'legStrength', 'gameIQ', 'passing'].includes(key)) v -= 5;
      if (p.position !== 'GK' && (key === 'reflexes' || key === 'gkPositioning')) v = 1 + hash01(p.id + key) * 4;
      v += (hash01(p.id + ':' + key) - 0.5) * 1.2; // small individual variation
      attrs[key] = clamp(Math.round(v), 1, 20);
    }

    const handGuessed = !p.hand;
    return {
      id: p.id,
      realId: p.id,
      clubId: p.clubId,
      name: `${p.firstName} ${p.lastName}`,
      cap: p.cap ?? 0,
      position: p.position,
      hand: p.hand ?? (hash01(p.id + ':hand') < 0.18 ? 'L' : 'R'),
      handGuessed,
      age,
      attrs,
      games: a?.games ?? 0,
    };
  });
}

/** Game teams for every club, ready for the match engine. */
export function toEngineTeams(data: DataSet, rated = ratePlayers(data)): Team[] {
  return data.clubs.map((club) => {
    const squad = rated.filter((p) => p.clubId === club.id);
    // Give players without a known cap number a free one.
    const used = new Set(squad.map((p) => p.cap).filter(Boolean));
    let next = 1;
    for (const p of squad.filter((x) => !x.cap)) {
      while (used.has(next)) next++;
      p.cap = next;
      used.add(next);
    }
    return {
      id: club.id,
      name: titleClub(club.shortName),
      short: club.id.replace(/^EA-/, ''),
      players: squad.sort((a, b) => a.cap - b.cap),
      tactics: { ...DEFAULT_TACTICS },
    };
  });
}

/** Squads the engine can actually play with: at least one goalkeeper and six field players. */
export function isPlayable(team: Team) {
  const gk = team.players.filter((p) => p.position === 'GK').length;
  return gk >= 1 && team.players.length - gk >= 6;
}

/** "VK NOVI BEOGRAD" → "VK Novi Beograd" (keeps short all-caps prefixes like VK, CN, AN, FTC) */
function titleClub(name: string) {
  return name
    .split(' ')
    .map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
}

export const positionsOrder: Position[] = ['GK', 'CENTER', 'CDEF', 'DRIVER', 'WING', 'POINT'];
