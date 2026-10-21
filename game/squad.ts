// Squad management between matches: fitness, injuries, training, morale and
// matchday selection. Everything is deterministic (seeded from the career seed).

import { createRng, type Rng } from '../engine/rng';
import { overall } from '../engine/ratings';
import type { Attributes, MatchResult, Player, Team } from '../engine/types';

export type TrainingFocus = 'balanced' | 'shooting' | 'swimming' | 'defence' | 'powerplay' | 'recovery';
export type TrainingIntensity = 'light' | 'normal' | 'hard';

export interface Training {
  focus: TrainingFocus;
  intensity: TrainingIntensity;
}

export interface Injury {
  name: string;
  weeksLeft: number;
}

export interface PlayerCondition {
  /** match fitness 0–100: the energy a player starts a match with */
  condition: number;
  injury?: Injury;
}

export interface Selection {
  /** the 13 players named for the match (2 goalkeepers + 11 field players) */
  matchday: string[];
  /** the starting seven: goalkeeper first */
  starters: string[];
}

export interface NewsItem {
  round: number;
  kind: 'injury' | 'recovered' | 'training' | 'result';
  text: string;
}

export const MATCHDAY_SIZE = 13;
export const MATCHDAY_GOALKEEPERS = 2;
export const DEFAULT_TRAINING: Training = { focus: 'balanced', intensity: 'normal' };
export const DEFAULT_MORALE = 60;

/** Which attributes each focus works on (goalkeepers always train their own). */
export const FOCUS_ATTRIBUTES: Record<TrainingFocus, (keyof Attributes)[]> = {
  balanced: ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ'],
  shooting: ['shootingPower', 'shootingAccuracy'],
  swimming: ['speed', 'stamina'],
  defence: ['positioning', 'wrestling', 'legStrength'],
  powerplay: ['passing', 'shootingAccuracy', 'gameIQ'],
  recovery: [],
};
const GOALKEEPER_ATTRIBUTES: (keyof Attributes)[] = ['reflexes', 'gkPositioning'];

export const FOCUS_LABELS: Record<TrainingFocus, string> = {
  balanced: 'Balanced',
  shooting: 'Shooting',
  swimming: 'Swimming & stamina',
  defence: 'Defence & 2m battle',
  powerplay: '6 on 5 play',
  recovery: 'Recovery',
};

const INTENSITY = {
  // weekly fitness recovery (a flat amount plus a share of what is missing: tired players recover faster),
  // attribute progress per week, weekly injury risk per player
  light: { recovery: 12, recoveryShare: 0.55, progress: 0.07, injury: 0.002 },
  normal: { recovery: 7, recoveryShare: 0.45, progress: 0.13, injury: 0.005 },
  hard: { recovery: 3, recoveryShare: 0.35, progress: 0.22, injury: 0.014 },
};
const weeklyRecovery = (condition: number, i: (typeof INTENSITY)[keyof typeof INTENSITY], bonus = 0) =>
  Math.min(100, Math.round(condition + i.recovery + bonus + (100 - condition) * i.recoveryShare));
const RECOVERY_FOCUS_BONUS = 10;
/** fitness lost per minute played */
const CONDITION_PER_MINUTE = 0.95;
const MIN_CONDITION = 25;

const INJURIES: { name: string; weeks: [number, number]; weight: number }[] = [
  { name: 'Shoulder strain', weeks: [1, 2], weight: 30 },
  { name: 'Finger sprain', weeks: [1, 2], weight: 20 },
  { name: 'Knee ligament strain', weeks: [2, 4], weight: 15 },
  { name: 'Hamstring strain', weeks: [1, 3], weight: 15 },
  { name: 'Concussion', weeks: [1, 2], weight: 8 },
  { name: 'Broken hand', weeks: [4, 7], weight: 7 },
  { name: 'Torn shoulder labrum', weeks: [8, 14], weight: 5 },
];

export function rollInjury(rng: Rng): Injury {
  const type = rng.weighted(INJURIES, (i) => i.weight);
  return { name: type.name, weeksLeft: rng.int(type.weeks[0], type.weeks[1]) };
}

/** How much a player develops in a week of training: young players learn fastest. */
export function ageFactor(age: number) {
  return age <= 20 ? 1.6 : age <= 23 ? 1.25 : age <= 27 ? 0.85 : age <= 30 ? 0.45 : 0.15;
}

export const available = (squad: Record<string, PlayerCondition>, id: string) => !squad[id]?.injury;

/** How the assistant ranks players for selection: ability, discounted when tired. */
const selectionValue = (p: Player, condition: number) => overall(p) * (0.75 + 0.25 * (condition / 100));

/** The fewest players a club can name: a goalkeeper and six field players. */
export const MATCHDAY_MINIMUM = 7;

/**
 * The players named for a match. If the manager has picked a squad, it is used as
 * it is (any positions: three centers or six drivers are fine), minus injured
 * players; only a missing goalkeeper or a squad below the minimum is topped up.
 * Without a pick, the assistant names the best 13: two goalkeepers and eleven
 * field players, favouring fresh legs.
 */
export function pickMatchday(team: Team, squad: Record<string, PlayerCondition>, wanted?: string[]): string[] {
  const fit = team.players.filter((p) => available(squad, p.id));
  const cond = (p: Player) => squad[p.id]?.condition ?? 100;
  const rank = (ps: Player[]) => [...ps].sort((a, b) => selectionValue(b, cond(b)) - selectionValue(a, cond(a)));
  const keepers = rank(fit.filter((p) => p.position === 'GK'));
  const field = rank(fit.filter((p) => p.position !== 'GK'));

  if (wanted && wanted.length) {
    const chosen = wanted.filter((id) => fit.some((p) => p.id === id)).slice(0, MATCHDAY_SIZE);
    const isKeeper = (id: string) => keepers.some((k) => k.id === id);
    if (!chosen.some(isKeeper) && keepers.length) {
      if (chosen.length >= MATCHDAY_SIZE) chosen.pop();
      chosen.unshift(keepers[0].id);
    }
    for (const p of field) if (chosen.filter((id) => !isKeeper(id)).length < MATCHDAY_MINIMUM - 1 && !chosen.includes(p.id)) chosen.push(p.id);
    return chosen;
  }
  const named = [...keepers.slice(0, MATCHDAY_GOALKEEPERS), ...field.slice(0, MATCHDAY_SIZE - Math.min(MATCHDAY_GOALKEEPERS, keepers.length))];
  return named.map((p) => p.id);
}

/** Starting seven within the matchday squad, if the manager's choice is valid. */
export function validStarters(team: Team, matchday: string[], starters?: string[]): string[] | undefined {
  if (!starters || starters.length !== 7 || new Set(starters).size !== 7) return undefined;
  if (!starters.every((id) => matchday.includes(id))) return undefined;
  const players = starters.map((id) => team.players.find((p) => p.id === id)!);
  if (players[0].position !== 'GK' || players.slice(1).some((p) => p.position === 'GK')) return undefined;
  return starters;
}

/** Morale nudges how well a team plays on the day: ±0.025 at the extremes. */
export const moraleBonus = (morale: number) => ((morale - DEFAULT_MORALE) / 40) * 0.025;

export function moraleAfter(morale: number, goalsFor: number, goalsAgainst: number) {
  const diff = goalsFor - goalsAgainst;
  const change = diff > 0 ? 5 + Math.min(diff, 5) : diff === 0 ? 1 : -5 + Math.max(diff, -5);
  // Morale drifts back toward normal over time.
  return Math.round(Math.max(15, Math.min(100, morale + change + (DEFAULT_MORALE - morale) * 0.08)));
}

/** Fitness lost in a match, by minutes played. */
export function conditionAfterMatch(condition: number, minutes: number) {
  return Math.max(MIN_CONDITION, Math.round(condition - minutes * CONDITION_PER_MINUTE));
}

export interface WeekReport {
  squad: Record<string, PlayerCondition>;
  teams: Team[];
  progress: Record<string, Partial<Record<keyof Attributes, number>>>;
  news: NewsItem[];
}

/**
 * A week between rounds: injured players heal, everyone recovers fitness, and the
 * managed club trains (attributes improve slowly; hard training risks injuries).
 */
export function trainingWeek(options: {
  round: number;
  seed: number;
  teams: Team[];
  squad: Record<string, PlayerCondition>;
  progress: Record<string, Partial<Record<keyof Attributes, number>>>;
  managedClubId: string;
  training: Training;
}): WeekReport {
  const { round, teams, managedClubId, training } = options;
  const rng = createRng((options.seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0);
  const squad = { ...options.squad };
  const progress = { ...options.progress };
  const news: NewsItem[] = [];
  const nextTeams = teams.map((team) => {
    const managed = team.id === managedClubId;
    const intensity = INTENSITY[managed ? training.intensity : 'normal'];
    const players = team.players.map((p) => {
      const before = squad[p.id] ?? { condition: 100 };
      const now: PlayerCondition = { ...before };
      if (now.injury) {
        const weeksLeft = now.injury.weeksLeft - 1;
        now.injury = weeksLeft > 0 ? { ...now.injury, weeksLeft } : undefined;
        if (!now.injury && managed) news.push({ round, kind: 'recovered', text: `${p.name} is fit again after his ${before.injury!.name.toLowerCase()}.` });
        now.condition = weeklyRecovery(now.condition, intensity);
        squad[p.id] = now;
        return p;
      }
      now.condition = weeklyRecovery(now.condition, intensity, managed && training.focus === 'recovery' ? RECOVERY_FOCUS_BONUS : 0);
      if (rng.chance(intensity.injury)) {
        now.injury = rollInjury(rng);
        if (managed) news.push({ round, kind: 'injury', text: `${p.name} picked up a ${now.injury.name.toLowerCase()} in training: out for ${now.injury.weeksLeft} week${now.injury.weeksLeft > 1 ? 's' : ''}.` });
      }
      squad[p.id] = now;
      if (!managed || training.focus === 'recovery') return p;

      // Training: progress builds up week by week; a full point raises the attribute.
      const attrs = p.position === 'GK' ? GOALKEEPER_ATTRIBUTES : FOCUS_ATTRIBUTES[training.focus];
      const perAttribute = (intensity.progress * ageFactor(p.age) * (training.focus === 'balanced' ? 2.2 : 1)) / Math.max(1, training.focus === 'balanced' ? attrs.length : 1);
      const mine = { ...(progress[p.id] ?? {}) };
      const nextAttrs = { ...p.attrs };
      for (const key of attrs) {
        if (nextAttrs[key] >= 20) continue;
        const value = (mine[key] ?? 0) + perAttribute * (0.7 + rng.next() * 0.6);
        if (value >= 1) {
          nextAttrs[key] += 1;
          mine[key] = value - 1;
          news.push({ round, kind: 'training', text: `${p.name} improved ${ATTRIBUTE_LABELS[key].toLowerCase()} to ${nextAttrs[key]}.` });
        } else mine[key] = value;
      }
      progress[p.id] = mine;
      return { ...p, attrs: nextAttrs };
    });
    return { ...team, players };
  });
  return { squad, teams: nextTeams, progress, news };
}

/** Injuries from a match: who got hurt and for how long. */
export function matchInjuries(result: MatchResult): { playerId: string; team: 0 | 1; injury: Injury }[] {
  const rng = createRng((result.seed ^ 0x1badb002) >>> 0);
  return result.events.filter((e) => e.type === 'injury').map((e) => ({ playerId: e.player!, team: e.team, injury: rollInjury(rng) }));
}

export const ATTRIBUTE_LABELS: Record<keyof Attributes, string> = {
  speed: 'Speed',
  stamina: 'Stamina',
  shootingPower: 'Shot power',
  shootingAccuracy: 'Accuracy',
  passing: 'Passing',
  legStrength: 'Legs',
  wrestling: 'Wrestling',
  positioning: 'Defending',
  gameIQ: 'Game IQ',
  reflexes: 'Reflexes',
  gkPositioning: 'GK positioning',
};
