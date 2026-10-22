// Backroom staff: coaches, a physio and scouts. Each has a rating (1–20) and a wage
// that comes out of the wage budget. Better staff mean better training, recovery,
// injury care and scouting. A vacant role works like a poor coach.

import { createRng, type Rng } from '../engine/rng';
import type { Attributes } from '../engine/types';

export type StaffRole = 'assistant' | 'attack' | 'defence' | 'goalkeeping' | 'fitness' | 'physio' | 'scout' | 'youth';

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  /** 1–20 */
  rating: number;
  /** euros per season */
  wage: number;
  age: number;
}

export const STAFF_ROLES: StaffRole[] = ['assistant', 'attack', 'defence', 'goalkeeping', 'fitness', 'physio', 'scout', 'youth'];

export const ROLE_LABELS: Record<StaffRole, string> = {
  assistant: 'Assistant coach',
  attack: 'Attacking coach',
  defence: 'Defensive coach',
  goalkeeping: 'Goalkeeping coach',
  fitness: 'Fitness coach',
  physio: 'Physio',
  scout: 'Chief scout',
  youth: 'Head of youth development',
};

export const ROLE_HELP: Record<StaffRole, string> = {
  assistant: 'Runs sessions: better training weeks for everyone, and sharper on match day.',
  attack: 'Shot power, accuracy, passing and the 6 on 5.',
  defence: 'Defending, wrestling and leg strength.',
  goalkeeping: 'Reflexes and positioning of your goalkeepers.',
  fitness: 'Speed and stamina, faster recovery between matches, fewer injuries.',
  physio: 'Injured players come back sooner.',
  scout: 'More scouting reports each week, and more accurate ones.',
  youth: 'More and better youngsters in the academy every summer, and faster development there.',
};

/** Attributes each coach develops. */
const COACHED: Partial<Record<StaffRole, (keyof Attributes)[]>> = {
  attack: ['shootingPower', 'shootingAccuracy', 'passing', 'gameIQ'],
  defence: ['positioning', 'wrestling', 'legStrength'],
  goalkeeping: ['reflexes', 'gkPositioning'],
  fitness: ['speed', 'stamina'],
};

const FIRST = ['Igor', 'Dejan', 'Zoran', 'Petar', 'Goran', 'Sandro', 'Massimo', 'Tibor', 'László', 'Jordi', 'Xavier', 'Stavros', 'Yannis', 'Ratko', 'Veljko', 'Milan', 'Paolo', 'Attila', 'Nenad', 'Bruno'];
// Ordinary surnames only: staff are fictional and should not look like real coaches.
const LAST = ['Jovanović', 'Petrović', 'Kovač', 'Novak', 'Horváth', 'Nagy', 'Rossi', 'Bianchi', 'Fernández', 'Ruiz', 'Papadakis', 'Christou', 'Marić', 'Đorđević', 'Simić', 'Tóth', 'Romano', 'Moreno', 'Kostić', 'Lukić'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Staff wages: modest for average coaches, steep for the best. */
export function staffWage(rating: number) {
  return Math.max(3000, Math.round((5000 * Math.pow(1.22, rating - 8)) / 1000) * 1000);
}

export function makeStaff(rng: Rng, role: StaffRole, rating: number, id: string): StaffMember {
  const r = clamp(Math.round(rating), 1, 20);
  return { id, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, role, rating: r, wage: Math.round((staffWage(r) * rng.range(0.9, 1.1)) / 1000) * 1000, age: rng.int(32, 64) };
}

/** A club's starting staff: around its level, with a gap or two at smaller clubs. */
export function initialStaff(seed: number, clubLevel: number): Partial<Record<StaffRole, StaffMember>> {
  const rng = createRng((seed ^ 0x57aff) >>> 0);
  const staff: Partial<Record<StaffRole, StaffMember>> = {};
  for (const role of STAFF_ROLES) {
    if (clubLevel < 13 && (role === 'goalkeeping' || role === 'physio') && rng.chance(0.5)) continue;
    staff[role] = makeStaff(rng, role, clubLevel - 3 + rng.range(-2.5, 2.5), `staff-${role}-0`);
  }
  return staff;
}

/** Candidates for each role: a spread from cheap and average to expensive and excellent. */
export function staffMarket(seed: number, season: string): StaffMember[] {
  let h = seed >>> 0;
  for (const ch of season) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rng = createRng(h);
  return STAFF_ROLES.flatMap((role) => [7, 10, 13, 16].map((base, i) => makeStaff(rng, role, base + rng.range(-1.5, 2), `staff-${season}-${role}-${i}`)));
}

export const staffWages = (staff: Partial<Record<StaffRole, StaffMember>>) => Object.values(staff).reduce((s, m) => s + (m?.wage ?? 0), 0);

/** How much a role adds: 0.75 with nobody, 1.0 for an average (10) coach, up to 1.4 for the best. */
export function staffFactor(staff: Partial<Record<StaffRole, StaffMember>> | undefined, role: StaffRole) {
  const m = staff?.[role];
  return m ? 0.8 + (m.rating / 20) * 0.6 : 0.75;
}

/** Training progress multiplier for an attribute, from the coach who covers it. */
export function coachingFactor(staff: Partial<Record<StaffRole, StaffMember>> | undefined, attr: keyof Attributes) {
  const role = (Object.keys(COACHED) as StaffRole[]).find((r) => COACHED[r]!.includes(attr));
  return role ? staffFactor(staff, role) : 1;
}

/** Training rating shift from the assistant coach: about ±0.5. */
export const assistantTrainingBoost = (staff: Partial<Record<StaffRole, StaffMember>> | undefined) => (staffFactor(staff, 'assistant') - 1) * 1.5;

/** Match-day form from the assistant coach (small). */
export const assistantFormBonus = (staff: Partial<Record<StaffRole, StaffMember>> | undefined) => (staffFactor(staff, 'assistant') - 1) * 0.02;

/** Extra fitness recovered per week thanks to the fitness coach. */
export const fitnessRecoveryBonus = (staff: Partial<Record<StaffRole, StaffMember>> | undefined) => Math.round((staffFactor(staff, 'fitness') - 1) * 12);

/** Injury risk multiplier from the fitness coach. */
export const injuryRiskFactor = (staff: Partial<Record<StaffRole, StaffMember>> | undefined) => clamp(2 - staffFactor(staff, 'fitness'), 0.6, 1.3);

/** Chance per week that the physio gets an injured player back a week sooner. */
export const physioSpeedUp = (staff: Partial<Record<StaffRole, StaffMember>> | undefined) => clamp((staffFactor(staff, 'physio') - 0.75) * 0.7, 0, 0.45);

/** Scouting reports per week: one per scout level band. */
export function scoutingCapacity(staff: Partial<Record<StaffRole, StaffMember>> | undefined) {
  const scout = staff?.scout;
  return scout ? 1 + Math.floor(scout.rating / 7) : 1;
}

/** A good scout sees exact attributes; a weaker one gets within a point. */
export const scoutAccuracy = (staff: Partial<Record<StaffRole, StaffMember>> | undefined): 'exact' | 'close' => ((staff?.scout?.rating ?? 0) >= 13 ? 'exact' : 'close');
