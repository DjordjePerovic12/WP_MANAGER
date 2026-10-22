// How happy each of the manager's players is (0–100), and why. Every player has a squad status
// (key player … youth) that sets how much he expects to play; after each of the club's matches his
// happiness moves toward a target built from clear reasons: minutes against that expectation, his
// wage, results, his contract, being on the transfer list, and his personality. Very unhappy
// players play a little worse, are harder to keep, and in the end ask to leave.

import { overall } from '../engine/ratings';
import { createRng } from '../engine/rng';
import type { Player } from '../engine/types';
import { nextMatchday, seasonYear, type CareerState } from './career';
import { expectedWage } from './finance';
import { personalityOf, type Personality } from './training';

export type SquadStatus = 'key' | 'regular' | 'rotation' | 'backup' | 'youth';
export const STATUSES: SquadStatus[] = ['key', 'regular', 'rotation', 'backup', 'youth'];
export const STATUS_LABELS: Record<SquadStatus, string> = { key: 'Key player', regular: 'Regular starter', rotation: 'Squad rotation', backup: 'Backup', youth: 'Hot prospect' };
/** Share of a match's 32 minutes each status expects over recent games. */
export const EXPECTED_SHARE: Record<SquadStatus, number> = { key: 0.68, regular: 0.5, rotation: 0.32, backup: 0.14, youth: 0.08 };

/** Positions that rotate more: centers and center-defenders share the 2-metre minutes. */
const POSITION_SHARE: Record<Player['position'], number> = { GK: 1, CENTER: 0.78, CDEF: 0.78, DRIVER: 1, WING: 0.95, POINT: 0.95 };
/** The minutes a player expects: his role's share, adjusted for his position. */
export const expectedShare = (status: SquadStatus, position: Player['position']) => (position === 'GK' ? GOALKEEPER_SHARE[status] : EXPECTED_SHARE[status] * POSITION_SHARE[position]);
/** One goalkeeper plays the whole match: the first choice expects nearly all of it, a backup almost none. */
const GOALKEEPER_SHARE: Record<SquadStatus, number> = { key: 0.85, regular: 0.5, rotation: 0.2, backup: 0.03, youth: 0.02 };

const DEFAULT_HAPPINESS = 65;
const RECENT_MATCHES = 6;
/** Below this for a few matches in a row, a player asks to leave. */
const REQUEST_BELOW = 25;
const REQUEST_AFTER = 4;

const SENSITIVITY: Record<Personality, number> = { ambitious: 1.4, temperamental: 1.2, professional: 1, lazy: 0.85, steady: 0.8 };
const BASE: Record<Personality, number> = { professional: 3, steady: 4, lazy: 2, ambitious: -2, temperamental: 0 };

export interface MoodFactor {
  text: string;
  /** points toward the target (positive: happier) */
  points: number;
}

export type Mood = 'delighted' | 'content' | 'unsettled' | 'unhappy' | 'wants-out';
export const MOOD_LABELS: Record<Mood, string> = { delighted: 'Delighted', content: 'Content', unsettled: 'Unsettled', unhappy: 'Unhappy', 'wants-out': 'Wants to leave' };
export const moodOf = (h: number): Mood => (h >= 80 ? 'delighted' : h >= 60 ? 'content' : h >= 40 ? 'unsettled' : h >= REQUEST_BELOW ? 'unhappy' : 'wants-out');

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Squad statuses when none were agreed: by standing in the squad (the best four are key players). */
function defaultStatuses(state: CareerState): Record<string, SquadStatus> {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const ranked = [...club.players].sort((a, b) => overall(b) - overall(a));
  return Object.fromEntries(
    ranked.map((p, i) => {
      // Goalkeepers: one starter, the others back him up.
      const keeperRank = ranked.filter((x) => x.position === 'GK').indexOf(p);
      const status: SquadStatus =
        p.position === 'GK' ? (keeperRank === 0 ? 'key' : p.age <= 20 ? 'youth' : 'backup') : i < 4 ? 'key' : i < 8 ? 'regular' : p.age <= 20 ? 'youth' : i < 11 ? 'rotation' : 'backup';
      return [p.id, status];
    }),
  );
}

export const statusOf = (state: CareerState, playerId: string): SquadStatus => state.squadStatus?.[playerId] ?? defaultStatuses(state)[playerId] ?? 'rotation';
export const happinessOf = (state: CareerState, playerId: string) => state.happiness?.[playerId] ?? DEFAULT_HAPPINESS;

/** The reasons behind a player's mood right now. */
export function moodFactors(state: CareerState, p: Player): MoodFactor[] {
  const personality = personalityOf(state.seed, p.id);
  const status = statusOf(state, p.id);
  const factors: MoodFactor[] = [];
  // Playing time over the club's recent matches (once a few have been played).
  const clubMatches = state.fixtures.filter((f) => f.result && (f.homeId === state.managedClubId || f.awayId === state.managedClubId)).sort((a, b) => a.date.localeCompare(b.date));
  const recent = clubMatches.slice(-RECENT_MATCHES);
  const expected = expectedShare(status, p.position);
  let share = expected;
  if (recent.length >= 3) {
    const log = state.matchLog?.[p.id] ?? [];
    const minutes = recent.reduce((s, f) => s + (log.find((m) => m.date === f.date)?.minutes ?? 0), 0);
    share = minutes / (recent.length * 32);
    const injured = !!state.squad[p.id]?.injury;
    const diff = share - expected;
    if (!injured && Math.abs(diff) > 0.1) {
      const points = Math.round(clamp(diff * 80, -45, 8) * SENSITIVITY[personality]);
      factors.push({ text: diff < 0 ? `Wants more playing time (${Math.round(share * 32)} minutes a game as ${STATUS_LABELS[status].toLowerCase()})` : `Enjoying his playing time (${Math.round(share * 32)} minutes a game)`, points });
    }
  }
  // Wage against what a player of his level earns.
  const contract = state.contracts[p.id];
  if (contract) {
    const ratio = contract.wage / expectedWage(p, state.potential[p.id]);
    if (ratio < 0.7) factors.push({ text: 'Feels badly underpaid', points: -12 });
    else if (ratio < 0.85) factors.push({ text: 'Feels underpaid', points: -6 });
    else if (ratio > 1.2) factors.push({ text: 'Happy with his wage', points: 5 });
    if (contract.until <= seasonYear(state.season) && p.age < 31 && !state.negotiations[p.id]?.closed) factors.push({ text: 'Unsure about his future: his contract is ending', points: -5 });
  }
  // Results.
  const morale = state.morale[state.managedClubId] ?? 60;
  // Results count for those who take part in them: a player who never plays shares little of the joy.
  const involvement = clamp(share / Math.max(0.1, expected), 0.2, 1);
  const results = Math.round(clamp((morale - 60) / 3, -10, 10) * (morale > 60 ? involvement : 1));
  if (Math.abs(results) >= 2) factors.push({ text: morale > 60 ? 'Enjoying the team’s results' : 'Frustrated by the team’s results', points: results });
  if (state.transferList.includes(p.id) && !state.transferRequests?.includes(p.id)) factors.push({ text: 'Upset at being put on the transfer list', points: -12 });
  if (state.transferRequests?.includes(p.id)) factors.push({ text: 'Has asked to leave', points: -5 });
  // The dressing room: a miserable leader drags others down; a delighted captain lifts them.
  const leaders = state.teams.find((t) => t.id === state.managedClubId)!.players.filter((x) => x.id !== p.id && (state.leaderIds ?? []).includes(x.id));
  const unhappyLeader = leaders.find((x) => happinessOf(state, x.id) < 35);
  if (unhappyLeader) factors.push({ text: `Unsettled by ${unhappyLeader.name}'s mood`, points: -4 });
  if (state.captainId && state.captainId !== p.id && happinessOf(state, state.captainId) >= 80) factors.push({ text: 'Lifted by the captain', points: 3 });
  if (state.captainId === p.id) factors.push({ text: 'Proud to be captain', points: 4 });
  const base = BASE[personality];
  if (base) factors.push({ text: base > 0 ? 'Easy-going by nature' : 'Hard to please', points: base });
  return factors;
}

/** Where a player's happiness is heading. */
export const moodTarget = (state: CareerState, p: Player) => clamp(DEFAULT_HAPPINESS + moodFactors(state, p).reduce((s, f) => s + f.points, 0), 5, 95);

/**
 * After one of the manager's matches: everyone's happiness moves a quarter of the way toward its
 * target (temperamental players swing more), and long-unhappy players hand in a transfer request.
 */
export function updateHappiness(state: CareerState): CareerState {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const md = nextMatchday(state) ?? 0;
  const rng = createRng((state.seed ^ Math.imul(md + 31, 0x45d9f3b) ^ club.players.length) >>> 0);
  const happiness: Record<string, number> = {};
  const unhappyWeeks: Record<string, number> = {};
  let requests = [...(state.transferRequests ?? [])];
  const news: string[] = [];
  for (const p of club.players) {
    const before = happinessOf(state, p.id);
    const swing = personalityOf(state.seed, p.id) === 'temperamental' ? rng.range(-6, 6) : 0;
    const now = Math.round(clamp(before + (moodTarget(state, p) - before) * 0.25 + swing, 0, 100));
    happiness[p.id] = now;
    if (moodOf(before) !== moodOf(now) && (now < 40 || before < 40)) news.push(now < before ? `${p.name} is ${MOOD_LABELS[moodOf(now)].toLowerCase()}.` : `${p.name} is happier again (${MOOD_LABELS[moodOf(now)].toLowerCase()}).`);
    unhappyWeeks[p.id] = now < REQUEST_BELOW ? (state.unhappyWeeks?.[p.id] ?? 0) + 1 : 0;
    if (unhappyWeeks[p.id] >= REQUEST_AFTER && !requests.includes(p.id)) {
      requests = [...requests, p.id];
      news.push(`${p.name} has handed in a transfer request: he wants to leave the club.`);
    }
    if (requests.includes(p.id) && now >= 45) {
      requests = requests.filter((id) => id !== p.id);
      news.push(`${p.name} has withdrawn his transfer request.`);
    }
  }
  return {
    ...state,
    happiness,
    unhappyWeeks,
    transferRequests: requests,
    // A transfer request goes to the manager's inbox (he lists the player, refuses or promises a move).
    transferList: state.transferList,
    news: [...state.news, ...news.map((text) => ({ round: md, kind: 'injury' as const, text }))].slice(-60),
  };
}

/** The dressing room: the average happiness of the squad. */
export function atmosphere(state: CareerState) {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  // Leaders count three times.
  const weight = (id: string) => ((state.leaderIds ?? []).includes(id) ? 3 : 1);
  const total = club.players.reduce((s, p) => s + weight(p.id), 0);
  return Math.round(club.players.reduce((s, p) => s + happinessOf(state, p.id) * weight(p.id), 0) / Math.max(1, total));
}

/**
 * Change a player's squad status. Promoting him pleases him now (but he expects the minutes);
 * demoting him hurts, more so for ambitious players.
 */
export function setSquadStatus(state: CareerState, playerId: string, status: SquadStatus): { message: string; state: CareerState } {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const p = club.players.find((x) => x.id === playerId);
  if (!p) return { message: 'He is not in your squad.', state };
  const old = statusOf(state, playerId);
  if (old === status) return { message: '', state };
  const step = STATUSES.indexOf(old) - STATUSES.indexOf(status); // positive: a bigger role
  const personality = personalityOf(state.seed, p.id);
  const change = step > 0 ? 8 * step : Math.round(10 * step * SENSITIVITY[personality]);
  const happiness = { ...(state.happiness ?? {}), [playerId]: clamp(happinessOf(state, playerId) + change, 0, 100) };
  const statuses = { ...defaultStatuses(state), ...(state.squadStatus ?? {}), [playerId]: status };
  const message =
    step > 0
      ? `${p.name} is delighted to be a ${STATUS_LABELS[status].toLowerCase()}, and will expect the minutes that go with it.`
      : personality === 'ambitious'
        ? `${p.name} is angry about becoming a ${STATUS_LABELS[status].toLowerCase()}.`
        : `${p.name} accepts becoming a ${STATUS_LABELS[status].toLowerCase()}, but he isn't happy about it.`;
  return { message, state: { ...state, squadStatus: statuses, happiness } };
}

/** Refuse a transfer request: he stays, off the list, and sulks for a while. */
export function rejectTransferRequest(state: CareerState, playerId: string): { message: string; state: CareerState } {
  const p = state.teams.find((t) => t.id === state.managedClubId)?.players.find((x) => x.id === playerId);
  if (!p || !state.transferRequests?.includes(playerId)) return { message: '', state };
  return {
    message: `You told ${p.name} he is staying. He will need time (and minutes) to get over it.`,
    state: {
      ...state,
      transferRequests: state.transferRequests.filter((id) => id !== playerId),
      transferList: state.transferList.filter((id) => id !== playerId),
      happiness: { ...(state.happiness ?? {}), [playerId]: clamp(happinessOf(state, playerId) - 5, 0, 100) },
      unhappyWeeks: { ...(state.unhappyWeeks ?? {}), [playerId]: -4 },
    },
  };
}

/** Match-day form from happiness: a point off the key attributes when miserable, a point on when delighted. */
export function moodShift(h: number) {
  return h < 25 ? -1 : h >= 85 ? 1 : 0;
}

/** Playing-time priority per player of the manager's club, from his role and any promise of minutes. */
export function playingTimePriority(state: CareerState): Record<string, number> {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const BY_ROLE: Record<SquadStatus, number> = { key: 1.15, regular: 1.06, rotation: 1, backup: 0.92, youth: 0.92 };
  const promised = new Set((state.promises ?? []).filter((p) => p.status === 'open' && p.kind === 'minutes').map((p) => p.playerId));
  return Object.fromEntries(club.players.map((p) => [p.id, promised.has(p.id) ? Math.max(1.15, BY_ROLE[statusOf(state, p.id)] + 0.1) : BY_ROLE[statusOf(state, p.id)]]));
}
