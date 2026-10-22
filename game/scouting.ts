// Scouting and the fog of war: you know your own players exactly; for everyone
// else you see estimated ranges until your scouts report on them.

import { overall, POSITION_WEIGHTS } from '../engine/ratings';
import type { Attributes, Player } from '../engine/types';
import { daysBetween, matchdayDate, nextMatchday, type CareerState } from './career';
import { potentialStars } from './development';
import { playerValue } from './finance';
import { personalityOf, type Personality } from './training';
import { scoutAccuracy, scoutingCapacity } from './staff';

export type Knowledge = 'own' | 'exact' | 'close' | 'unknown';

export interface ScoutReport {
  season: string;
  accuracy: 'exact' | 'close';
}

export interface AttributeView {
  low: number;
  high: number;
  exact: boolean;
}

export interface PlayerView {
  knowledge: Knowledge;
  attrs: Record<keyof Attributes, AttributeView>;
  overall: { low: number; high: number; estimate: number };
  potentialStars: { low: number; high: number };
  personality?: Personality;
}

const KEYS: (keyof Attributes)[] = ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ', 'reflexes', 'gkPositioning'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function noise(seed: number, key: string) {
  let h = (seed ^ 0x2545f491) >>> 0;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 10000) / 10000;
}

const clubOf = (state: CareerState, playerId: string) => state.teams.find((t) => t.players.some((p) => p.id === playerId));

/** How well you know a player. Reports from this season or last still count. */
export function knowledgeOf(state: CareerState, playerId: string): Knowledge {
  if (clubOf(state, playerId)?.id === state.managedClubId || state.academy?.some((p) => p.id === playerId)) return 'own';
  const report = state.scouting[playerId];
  if (!report) return 'unknown';
  const year = Number(state.season.slice(0, 4));
  if (Number(report.season.slice(0, 4)) < year - 1) return 'unknown';
  return report.accuracy;
}

/**
 * What you can see of a player: exact values, a ±1 window after a weaker scout's
 * report, or a wide range (about ±2–3) for unscouted players. Ranges are stable:
 * the true value sits somewhere inside, not always in the middle.
 */
export function playerView(state: CareerState, p: Player): PlayerView {
  const knowledge = knowledgeOf(state, p.id);
  const attrs = {} as Record<keyof Attributes, AttributeView>;
  for (const key of KEYS) {
    const v = p.attrs[key];
    if (knowledge === 'own' || knowledge === 'exact') attrs[key] = { low: v, high: v, exact: true };
    else {
      const width = knowledge === 'close' ? 2 : 5;
      const below = Math.round(noise(state.seed, `${p.id}/${key}`) * width);
      attrs[key] = { low: clamp(v - below, 1, 20), high: clamp(v - below + width, 1, 20), exact: false };
    }
  }
  const weights = POSITION_WEIGHTS[p.position];
  const weighted = (pick: (a: AttributeView) => number) => Object.entries(weights).reduce((s, [k, w]) => s + pick(attrs[k as keyof Attributes]) * (w ?? 0), 0);
  const low = weighted((a) => a.low);
  const high = weighted((a) => a.high);
  const known = knowledge === 'own' || knowledge === 'exact';
  const potential = state.potential[p.id] ?? overall(p);
  const stars = potentialStars(potential);
  const starSpread = known ? 0 : knowledge === 'close' ? 0 : 1;
  return {
    knowledge,
    attrs,
    overall: known ? { low: overall(p), high: overall(p), estimate: overall(p) } : { low, high, estimate: (low + high) / 2 },
    potentialStars: { low: clamp(stars - starSpread, 1, 5), high: clamp(stars + starSpread, 1, 5) },
    personality: knowledge === 'unknown' ? undefined : personalityOf(state.seed, p.id),
  };
}

/** "This week" for scouting: the calendar week of the next matchday (pre-season counts as its own week). */
function scoutingWeek(state: CareerState) {
  if (!state.fixtures.some((f) => f.result)) return `${state.season}/pre`;
  const md = nextMatchday(state);
  const date = md === undefined ? undefined : matchdayDate(state, md);
  if (!date) return `${state.season}/end`;
  // Weeks run Monday to Sunday: count them from a fixed Monday.
  return `${state.season}/w${Math.floor(daysBetween('2024-01-01', date) / 7)}`;
}

export function scoutingLeft(state: CareerState) {
  const used = state.scoutingUsed?.week === scoutingWeek(state) ? state.scoutingUsed.count : 0;
  return Math.max(0, scoutingCapacity(state.staff) - used);
}

/** Send the scouts to a player: the report comes in straight away and uses one of this week's slots. */
export function scoutPlayer(state: CareerState, playerId: string): { message: string; state: CareerState } {
  if (knowledgeOf(state, playerId) === 'own') return { message: 'He is one of your players.', state };
  if (knowledgeOf(state, playerId) === 'exact') return { message: 'You already have a full report on him.', state };
  if (scoutingLeft(state) <= 0) return { message: 'Your scouts are busy this week. More reports next week (or hire a better scout).', state };
  const accuracy = scoutAccuracy(state.staff);
  const week = scoutingWeek(state);
  const used = state.scoutingUsed?.week === week ? state.scoutingUsed.count : 0;
  const next = { ...state, scouting: { ...state.scouting, [playerId]: { season: state.season, accuracy } }, scoutingUsed: { week, count: used + 1 } };
  return { message: accuracy === 'exact' ? 'Full report in: exact attributes, personality and potential.' : 'Report in: attributes to within a point, and his personality.', state: next };
}

/** The scout's verdict on a player, for your club. */
export function scoutVerdict(state: CareerState, p: Player, askingPrice: number): string {
  const view = playerView(state, p);
  if (view.knowledge === 'unknown') return 'Not scouted yet.';
  const mine = state.teams.find((t) => t.id === state.managedClubId)!;
  const samePosition = mine.players.filter((x) => x.position === p.position).map((x) => overall(x)).sort((a, b) => b - a);
  const est = view.overall.estimate;
  const role = samePosition.length === 0 || est > samePosition[0] + 0.3 ? 'would walk into your team' : est > (samePosition[1] ?? 0) ? 'would compete for a starting place' : 'would be a squad player for you';
  const value = playerValue(p, state.potential[p.id]);
  const price = askingPrice === 0 ? 'available on a free' : askingPrice <= value * 1.1 ? 'fairly priced' : askingPrice <= value * 1.6 ? 'a bit expensive' : 'overpriced';
  const growth = (state.potential[p.id] ?? est) - est >= 2 && p.age <= 23 ? ' Real room to grow.' : p.age >= 31 ? ' Past his peak.' : '';
  return `${p.position === 'GK' ? 'Goalkeeper' : 'He'} ${role}, ${price}.${growth}`;
}
