// Player development over the years: potential, growth, decline, retirement and
// youth academy players. Deterministic: every random choice comes from a seeded rng.

import { generatePlayer } from '../engine/generate';
import { overall, POSITION_WEIGHTS, teamRating } from '../engine/ratings';
import type { Rng } from '../engine/rng';
import type { Attributes, Player, Position, Team } from '../engine/types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export const MAX_SQUAD = 18;
export const MIN_SQUAD = 13;
/** Clubs aim for about this many players; the academy tops squads up toward it. */
export const TARGET_SQUAD = 16;
export const MAX_POTENTIAL = 19.5;

const PHYSICAL: (keyof Attributes)[] = ['speed', 'stamina', 'legStrength', 'wrestling', 'shootingPower'];
const KEEPER_DECLINE: (keyof Attributes)[] = ['reflexes', 'legStrength', 'stamina'];

/**
 * A player's potential: the overall rating he can grow to. Young players have the
 * most room; players in their late twenties are about as good as they will get.
 */
export function initialPotential(p: Player, rng: Rng): number {
  const ovr = overall(p);
  const headroom = p.age <= 18 ? 4.5 : p.age <= 20 ? 3.5 : p.age <= 22 ? 2.5 : p.age <= 25 ? 1.3 : p.age <= 28 ? 0.5 : 0;
  return round1(clamp(ovr + headroom * (0.2 + rng.next() * 0.8), ovr, MAX_POTENTIAL));
}

/** Potential shown as 1–5 stars (how FM-style scouts describe it). */
export const potentialStars = (potential: number) => clamp(Math.round((potential - 8) / 2.2), 1, 5);

/** Raise or lower attributes one point at a time until the overall rating reaches the target. */
function moveTowards(p: Player, target: number, rng: Rng, pool: (keyof Attributes)[], step: 1 | -1): Player {
  const attrs = { ...p.attrs };
  const current = () => overall({ ...p, attrs });
  const weights = POSITION_WEIGHTS[p.position];
  for (let guard = 0; guard < 60; guard++) {
    if (step > 0 ? current() >= target : current() <= target) break;
    const options = pool.filter((k) => (step > 0 ? attrs[k] < 20 : attrs[k] > 1));
    if (!options.length) break;
    const key = rng.weighted(options, (k) => (weights[k] ?? 0.02) + 0.05);
    attrs[key] += step;
  }
  return { ...p, attrs };
}

/**
 * One year of development (the player has just aged a year):
 * young players grow toward their potential, players around their peak barely
 * change, and veterans decline, physical attributes first.
 */
export function developPlayer(p: Player, potential: number, rng: Rng): Player {
  const ovr = overall(p);
  const all = Object.keys(POSITION_WEIGHTS[p.position]) as (keyof Attributes)[];
  if (p.age <= 24) {
    const share = p.age <= 19 ? 0.36 : p.age <= 21 ? 0.3 : 0.22;
    const growth = Math.max(0, potential - ovr) * share * (0.6 + rng.next() * 0.8);
    return moveTowards(p, Math.min(potential, ovr + growth), rng, all, 1);
  }
  if (p.age <= 29) {
    const change = rng.range(-0.3, 0.25);
    const target = Math.min(potential, ovr + change);
    return change >= 0 ? moveTowards(p, target, rng, all, 1) : moveTowards(p, target, rng, p.position === 'GK' ? KEEPER_DECLINE : PHYSICAL, -1);
  }
  const decline = p.age <= 32 ? rng.range(0.2, 0.7) : rng.range(0.6, 1.4);
  const declined = moveTowards(p, ovr - decline, rng, p.position === 'GK' ? KEEPER_DECLINE : PHYSICAL, -1);
  // Experience still counts: game IQ can keep improving a little.
  if (rng.chance(0.35) && declined.attrs.gameIQ < 20) return { ...declined, attrs: { ...declined.attrs, gameIQ: declined.attrs.gameIQ + 1 } };
  return declined;
}

/** Chance a player retires this summer. */
export function retirementChance(p: Player, clubLevel: number) {
  // Veterans who are still among the club's best tend to keep going.
  const stillTopClass = overall(p) >= clubLevel;
  if (p.age >= 34) return clamp(0.3 + 0.2 * (p.age - 34), 0, 0.9) * (stillTopClass ? 0.35 : 1);
  if (p.age >= 32) return overall(p) < clubLevel - 2 ? 0.35 : 0.12;
  if (p.age >= 30 && overall(p) < clubLevel - 3) return 0.2;
  return 0;
}

/** How many academy players a club brings in this summer. */
export function intakeSize(squadSize: number, rng: Rng) {
  if (squadSize < MIN_SQUAD) return MIN_SQUAD - squadSize + 1;
  if (squadSize < TARGET_SQUAD) return rng.int(1, 2) + (rng.chance(0.3) ? 1 : 0);
  return 0;
}

const FIELD_POSITIONS: Position[] = ['CENTER', 'CDEF', 'DRIVER', 'DRIVER', 'WING', 'POINT'];

/** Academy players for a club: 16–18-year-olds, more talented at stronger clubs. */
export function youthIntake(team: Team, rng: Rng, year: number, needGoalkeeper: boolean, count: number): { player: Player; potential: number }[] {
  const level = teamRating(team.players);
  const used = new Set(team.players.map((p) => p.cap));
  const freeCap = () => {
    let cap = 2;
    while (used.has(cap)) cap++;
    used.add(cap);
    return cap;
  };
  return Array.from({ length: count }, (_, i) => {
    const position = i === 0 && needGoalkeeper ? 'GK' : rng.pick(FIELD_POSITIONS);
    const age = rng.int(16, 18);
    const base = generatePlayer(rng, position, level - 5 + rng.range(-1, 1), `${team.id}-Y${year}-${i + 1}`, freeCap());
    const player = { ...base, age };
    // Most academy players top out below the first team's level; now and then a real talent comes through.
    const gem = rng.chance(0.12);
    const potential = round1(clamp(level + (gem ? rng.range(1, 4) : rng.range(-5, 0.5)), overall(player) + 1, MAX_POTENTIAL));
    return { player, potential };
  });
}

/**
 * Where the board expects the club to finish: its rank by squad strength,
 * with a little benefit of the doubt.
 */
export function boardExpectation(teams: Team[], clubId: string): number {
  const ranked = [...teams].sort((a, b) => teamRating(b.players) - teamRating(a.players));
  return ranked.findIndex((t) => t.id === clubId) + 1;
}

export function boardVerdict(position: number, expected: number): { label: string; tone: 'great' | 'good' | 'meh' | 'bad' } {
  if (position === 1 && expected > 1) return { label: 'Champions against the odds: the board is delighted', tone: 'great' };
  if (position <= expected - 2) return { label: 'Exceeded expectations', tone: 'great' };
  if (position <= expected) return { label: 'Met expectations', tone: 'good' };
  if (position <= expected + 2) return { label: 'Slightly below expectations', tone: 'meh' };
  return { label: 'Well below expectations: the board is disappointed', tone: 'bad' };
}
