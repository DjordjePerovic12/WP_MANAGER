// Weekly training: personalities, individual focus, a 1–10 rating per player,
// how each player responded, and the progress it earns. Also the week's fitness
// recovery and injuries for every club. Deterministic (seeded).

import { createRng, type Rng } from '../engine/rng';
import { overall } from '../engine/ratings';
import type { Attributes, Player, Team } from '../engine/types';
import {
  ageFactor,
  ATTRIBUTE_LABELS,
  FOCUS_ATTRIBUTES,
  FOCUS_LABELS,
  INTENSITY,
  RECOVERY_FOCUS_BONUS,
  rollInjury,
  weeklyRecovery,
  type NewsItem,
  type PlayerCondition,
  type Training,
} from './squad';

export type Personality = 'professional' | 'ambitious' | 'steady' | 'lazy' | 'temperamental';
export type IndividualFocus = 'team' | 'shooting' | 'swimming' | 'defence' | 'powerplay' | 'goalkeeping' | 'rest';

export const PERSONALITY_LABELS: Record<Personality, string> = {
  professional: 'Professional',
  ambitious: 'Ambitious',
  steady: 'Steady',
  lazy: 'Laid-back',
  temperamental: 'Temperamental',
};
export const PERSONALITY_HELP: Record<Personality, string> = {
  professional: 'Trains hard every week: reliable progress.',
  ambitious: 'Driven to improve, and wants to play.',
  steady: 'Consistent, rarely surprises either way.',
  lazy: 'Talented maybe, but coasts in training.',
  temperamental: 'Brilliant one week, switched off the next.',
};
export const INDIVIDUAL_LABELS: Record<IndividualFocus, string> = {
  team: 'Team plan',
  shooting: 'Shooting',
  swimming: 'Swimming & stamina',
  defence: 'Defence & 2m',
  powerplay: '6 on 5 play',
  goalkeeping: 'Goalkeeping',
  rest: 'Rest',
};

const PERSONALITY_SHIFT: Record<Personality, number> = { professional: 0.9, ambitious: 0.5, steady: 0, lazy: -0.9, temperamental: 0 };
const PERSONALITY_SPREAD: Record<Personality, number> = { professional: 0.8, ambitious: 1.1, steady: 0.6, lazy: 1.1, temperamental: 2.4 };
const GOALKEEPING: (keyof Attributes)[] = ['reflexes', 'gkPositioning'];
const RATING_HISTORY = 8;

/** A player's personality never changes: it is derived from the career seed and his id. */
export function personalityOf(seed: number, playerId: string): Personality {
  let h = (seed ^ 0x5bd1e995) >>> 0;
  for (const ch of playerId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const r = (h % 1000) / 1000;
  return r < 0.2 ? 'professional' : r < 0.4 ? 'ambitious' : r < 0.75 ? 'steady' : r < 0.87 ? 'lazy' : 'temperamental';
}

/** Which attributes a player works on this week. */
export function focusAttributes(p: Player, team: Training, individual: IndividualFocus = 'team'): (keyof Attributes)[] {
  if (individual === 'rest') return [];
  if (p.position === 'GK') return individual === 'team' || individual === 'goalkeeping' ? GOALKEEPING : individual === 'swimming' ? ['stamina', 'legStrength'] : GOALKEEPING;
  if (individual === 'goalkeeping') return [];
  const focus = individual === 'team' ? team.focus : individual;
  return FOCUS_ATTRIBUTES[focus];
}

export function focusLabel(p: Player, team: Training, individual: IndividualFocus = 'team') {
  if (individual === 'team') return p.position === 'GK' && team.focus !== 'recovery' ? 'Goalkeeping (team plan)' : `${FOCUS_LABELS[team.focus]} (team plan)`;
  return INDIVIDUAL_LABELS[individual];
}

export interface TrainingEntry {
  playerId: string;
  /** 1–10; undefined when injured or resting */
  rating?: number;
  tone: 'great' | 'good' | 'ok' | 'poor' | 'rest' | 'injured';
  note: string;
  focus: string;
  gains: (keyof Attributes)[];
  breakthrough?: boolean;
}

export interface TrainingReport {
  round: number;
  entries: TrainingEntry[];
}

const pick = <T,>(rng: Rng, xs: T[]) => xs[Math.floor(rng.next() * xs.length)];

function noteFor(rng: Rng, rating: number, personality: Personality, condition: number, focus: string): { tone: TrainingEntry['tone']; note: string } {
  if (condition < 55) return { tone: 'poor', note: pick(rng, ['Heavy legs all week: consider resting him.', 'Running on empty. A lighter week would help.']) };
  if (rating >= 8.5)
    return {
      tone: 'great',
      note: pick(rng, [
        'Outstanding week: stayed after practice for extra work.',
        `Sharpest player in the ${focus.toLowerCase().replace(' (team plan)', '')} sessions.`,
        'Set the standard for the whole squad.',
        personality === 'temperamental' ? 'One of his brilliant weeks: unplayable in training.' : 'Coaches singled him out for praise.',
      ]),
    };
  if (rating >= 7) return { tone: 'good', note: pick(rng, ['Good, focused week.', 'Worked hard and it showed.', 'Solid sessions, taking things on board.']) };
  if (rating >= 5.5) return { tone: 'ok', note: pick(rng, ['An ordinary week.', 'Did what was asked, nothing more.', 'Steady, unspectacular.']) };
  return {
    tone: 'poor',
    note:
      personality === 'lazy'
        ? pick(rng, ['Coasted through the sessions.', 'Looked unmotivated; skipped the extra work.'])
        : personality === 'temperamental'
          ? pick(rng, ['Switched off and argued with a coach.', 'Frustrated week: his head was elsewhere.'])
          : pick(rng, ['Struggled to keep up this week.', 'An off week: sloppy in the drills.']),
  };
}

export interface TrainingWeekResult {
  squad: Record<string, PlayerCondition>;
  teams: Team[];
  progress: Record<string, Partial<Record<keyof Attributes, number>>>;
  news: NewsItem[];
  report: TrainingReport;
  ratings: Record<string, number[]>;
}

/**
 * A week between rounds: injured players heal, everyone recovers fitness, and the
 * managed club trains. Each of the manager's players gets a training rating from
 * his personality, fitness, morale and luck; better weeks bring faster progress.
 */
export function trainingWeek(options: {
  round: number;
  seed: number;
  teams: Team[];
  squad: Record<string, PlayerCondition>;
  progress: Record<string, Partial<Record<keyof Attributes, number>>>;
  managedClubId: string;
  training: Training;
  individual?: Record<string, IndividualFocus>;
  morale?: number;
  ratings?: Record<string, number[]>;
  /** minutes played this season per player, for players asking for more playing time */
  minutes?: Record<string, number>;
  roundsPlayed?: number;
}): TrainingWeekResult {
  const { round, teams, managedClubId, training } = options;
  const individual = options.individual ?? {};
  const rng = createRng((options.seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0);
  const squad = { ...options.squad };
  const progress = { ...options.progress };
  const ratings = { ...(options.ratings ?? {}) };
  const news: NewsItem[] = [];
  const entries: TrainingEntry[] = [];
  const moraleEffect = (((options.morale ?? 60) - 60) / 40) * 0.6;

  const nextTeams = teams.map((team) => {
    const managed = team.id === managedClubId;
    const intensity = INTENSITY[managed ? training.intensity : 'normal'];
    const medianOverall = [...team.players].map((p) => overall(p)).sort((a, b) => a - b)[Math.floor(team.players.length / 2)] ?? 0;
    const players = team.players.map((p) => {
      const own = managed ? (individual[p.id] ?? 'team') : 'team';
      const before = squad[p.id] ?? { condition: 100 };
      const now: PlayerCondition = { ...before };

      if (now.injury) {
        const weeksLeft = now.injury.weeksLeft - 1;
        now.injury = weeksLeft > 0 ? { ...now.injury, weeksLeft } : undefined;
        if (!now.injury && managed) news.push({ round, kind: 'recovered', text: `${p.name} is fit again after his ${before.injury!.name.toLowerCase()}.` });
        now.condition = weeklyRecovery(now.condition, intensity);
        squad[p.id] = now;
        if (managed) entries.push({ playerId: p.id, tone: 'injured', note: now.injury ? `Rehab: ${now.injury.weeksLeft} week${now.injury.weeksLeft > 1 ? 's' : ''} to go.` : 'Back in full training next week.', focus: 'Rehab', gains: [] });
        return p;
      }

      const resting = managed && (own === 'rest' || training.focus === 'recovery');
      const bonus = managed && (own === 'rest' || training.focus === 'recovery') ? RECOVERY_FOCUS_BONUS : 0;
      const conditionBefore = now.condition;
      now.condition = weeklyRecovery(now.condition, intensity, bonus);
      // Resting players and the light sessions of recovery weeks carry little injury risk.
      if (rng.chance(resting ? intensity.injury * 0.2 : intensity.injury)) {
        now.injury = rollInjury(rng);
        if (managed) news.push({ round, kind: 'injury', text: `${p.name} picked up a ${now.injury.name.toLowerCase()} in training: out for ${now.injury.weeksLeft} week${now.injury.weeksLeft > 1 ? 's' : ''}.` });
      }
      squad[p.id] = now;
      if (!managed) return p;

      const focus = focusLabel(p, training, own);
      if (resting) {
        entries.push({ playerId: p.id, tone: 'rest', note: own === 'rest' ? 'Rested: recovering for the weekend.' : 'Recovery week for the squad.', focus, gains: [] });
        return p;
      }

      // How well did he train this week?
      const personality = personalityOf(options.seed, p.id);
      const breakthrough = p.age <= 22 && rng.chance(0.025);
      let rating =
        6.4 +
        PERSONALITY_SHIFT[personality] +
        (training.intensity === 'hard' ? -0.2 : training.intensity === 'light' ? 0.2 : 0) +
        (conditionBefore < 55 ? -1.2 : conditionBefore < 70 ? -0.5 : 0) +
        moraleEffect +
        (rng.next() * 2 - 1) * PERSONALITY_SPREAD[personality];
      if (breakthrough) rating = 10;
      rating = Math.round(Math.max(1, Math.min(10, rating)) * 10) / 10;
      ratings[p.id] = [...(ratings[p.id] ?? []), rating].slice(-RATING_HISTORY);

      // Progress: a full point raises the attribute. Good weeks count for more.
      const attrs = focusAttributes(p, training, own);
      const spread = own === 'team' && training.focus === 'balanced' && p.position !== 'GK';
      const quality = 0.4 + (rating / 10) * 1.2;
      const perAttribute = (intensity.progress * ageFactor(p.age) * quality * (breakthrough ? 2.5 : 1) * (spread ? 2.2 : 1)) / Math.max(1, spread ? attrs.length : 1);
      const mine = { ...(progress[p.id] ?? {}) };
      const nextAttrs = { ...p.attrs };
      const gains: (keyof Attributes)[] = [];
      for (const key of attrs) {
        if (nextAttrs[key] >= 20) continue;
        const value = (mine[key] ?? 0) + perAttribute * (0.7 + rng.next() * 0.6);
        if (value >= 1) {
          nextAttrs[key] += 1;
          mine[key] = value - 1;
          gains.push(key);
          news.push({ round, kind: 'training', text: `${p.name} improved ${ATTRIBUTE_LABELS[key].toLowerCase()} to ${nextAttrs[key]}.` });
        } else mine[key] = value;
      }
      progress[p.id] = mine;

      const { tone, note } = breakthrough
        ? { tone: 'great' as const, note: 'Breakthrough week! Everything clicked: big progress.' }
        : noteFor(rng, rating, personality, conditionBefore, focus);
      if (breakthrough) news.push({ round, kind: 'training', text: `${p.name} (${p.age}) had a breakthrough week in training.` });

      // Ambitious players who are good enough but rarely play let you know.
      const played = options.minutes?.[p.id] ?? 0;
      const rounds = options.roundsPlayed ?? 0;
      if (personality === 'ambitious' && rounds >= 4 && played / rounds < 8 && overall(p) >= medianOverall && rng.chance(0.15)) {
        news.push({ round, kind: 'injury', text: `${p.name} wants more playing time: he has played ${played} minutes in ${rounds} rounds.` });
      }
      entries.push({ playerId: p.id, rating, tone, note, focus, gains, breakthrough });
      return { ...p, attrs: nextAttrs };
    });
    return { ...team, players };
  });
  return { squad, teams: nextTeams, progress, news, report: { round, entries }, ratings };
}
