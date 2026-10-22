// The youth academy of the manager's club: youngsters (15–19) who develop over the seasons until
// the manager promotes them to the first team or lets them go. Every summer a new intake arrives;
// how many and how good depends on the Head of Youth Development. At 20 they have to be promoted
// or they leave. (AI clubs keep their simpler academy: youngsters join their first team directly.)

import { generatePlayer } from '../engine/generate';
import { overall, POSITION_WEIGHTS, teamRating } from '../engine/ratings';
import { createRng, type Rng } from '../engine/rng';
import type { Attributes, Player, Position, Team } from '../engine/types';
import { nextMatchday, seasonYear, type CareerState } from './career';
import { MAX_POTENTIAL, MAX_REGISTERED } from './development';
import { expectedWage, formatMoney } from './finance';
import { staffFactor, type StaffMember, type StaffRole } from './staff';

/** The oldest an academy player can be: turning 20, he is promoted or leaves. */
export const ACADEMY_MAX_AGE = 19;
const FIELD: Position[] = ['CENTER', 'CDEF', 'DRIVER', 'DRIVER', 'WING', 'POINT'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** New academy players: more and better with a good Head of Youth Development. */
export function academyIntake(
  team: Team,
  staff: Partial<Record<StaffRole, StaffMember>> | undefined,
  rng: Rng,
  year: number,
  options: { count?: number; ages?: [number, number]; needGoalkeeper?: boolean; idPrefix?: string } = {},
): { player: Player; potential: number }[] {
  const level = teamRating(team.players);
  const youth = staff?.youth?.rating ?? 0;
  const factor = staffFactor(staff, 'youth'); // 0.75 vacant … 1.4 the best
  const count = options.count ?? 2 + Math.round(youth / 7) + (rng.chance(0.3) ? 1 : 0);
  const [minAge, maxAge] = options.ages ?? [15, 16];
  return Array.from({ length: count }, (_, i) => {
    const position: Position = i === 0 && (options.needGoalkeeper || rng.chance(0.18)) ? 'GK' : rng.pick(FIELD);
    const age = rng.int(minAge, maxAge);
    // Overall now: younger players start further below the first team (a generated player's
    // overall comes out about 1.5 above the quality asked for).
    const now = level - 6 + (age - 15) * 1.1 + (factor - 1) * 3 + rng.range(-1, 1);
    const base = generatePlayer(rng, position, now - 1.5, `${options.idPrefix ?? `${team.id}-A${year}`}-${i + 1}`, 0);
    const player = { ...base, age };
    const gem = rng.chance(0.08 + youth * 0.006);
    // Most become squad players at best; a gem can outgrow the first team.
    const potential = round1(clamp(level + (gem ? rng.range(1.5, 4.5) : rng.range(-3.5, 1)) + (factor - 1) * 2, overall(player) + 2, MAX_POTENTIAL));
    return { player, potential };
  });
}

/** A starting academy for a career (or an older save): six youngsters of 15 to 18. */
export function initialAcademy(state: Pick<CareerState, 'seed' | 'season' | 'managedClubId' | 'teams' | 'staff'>) {
  const team = state.teams.find((t) => t.id === state.managedClubId)!;
  const year = seasonYear(state.season);
  return academyIntake(team, state.staff, createRng((state.seed ^ 0xacade) >>> 0), year, { count: 6, ages: [15, 18], idPrefix: `${team.id}-A${year}s` });
}

/**
 * A week of youth training: each youngster moves a little toward his potential, faster with a
 * better Head of Youth Development. Progress is in attribute points; a full point raises one.
 */
export function academyWeek(state: CareerState, days: number, rng: Rng): Pick<CareerState, 'academy' | 'academyProgress'> {
  const factor = staffFactor(state.staff, 'youth');
  const share = Math.min(1, days / 7);
  const progress = { ...(state.academyProgress ?? {}) };
  const academy = (state.academy ?? []).map((p) => {
    const headroom = Math.max(0, (state.potential[p.id] ?? overall(p)) - overall(p));
    let points = (progress[p.id] ?? 0) + headroom * 0.035 * factor * share * (0.6 + rng.next() * 0.8);
    const keys = Object.keys(POSITION_WEIGHTS[p.position]) as (keyof Attributes)[];
    const attrs = { ...p.attrs };
    while (points >= 1) {
      const key = rng.pick(keys);
      if (attrs[key] < 20) attrs[key]++;
      points -= 1;
    }
    progress[p.id] = points;
    return { ...p, attrs };
  });
  return { academy, academyProgress: progress };
}

/** The summer in the academy: a year older and better, the 20-year-olds leave, a new intake arrives. */
export function academySummer(state: CareerState, team: Team, year: number, rng: Rng, develop: (p: Player, potential: number) => Player) {
  const left: Player[] = [];
  const stayed: Player[] = [];
  for (const p of state.academy ?? []) {
    const older = develop({ ...p, age: p.age + 1 }, state.potential[p.id] ?? overall(p));
    (older.age > ACADEMY_MAX_AGE ? left : stayed).push(older);
  }
  const intake = academyIntake(team, state.staff, rng, year);
  return { academy: [...stayed, ...intake.map((i) => i.player)], intake, left };
}

/** A free cap number for a new first-team player: 1/13 and up for goalkeepers, 2 and up otherwise. */
export function freeCap(players: Player[], position: Position) {
  const used = new Set(players.map((x) => x.cap));
  let cap = position === 'GK' ? 13 : 2;
  while (used.has(cap)) cap++;
  return cap;
}

/** First-team contract for a promoted academy player: a modest wage, three seasons. */
export const youthContract = (p: Player, potential: number, year: number) => ({ wage: Math.max(3000, Math.round((expectedWage(p, potential) * 0.6) / 1000) * 1000), until: year + 3 });

/** Promote an academy player to the first team. */
export function promoteYouth(state: CareerState, playerId: string): { message: string; state: CareerState } {
  const p = (state.academy ?? []).find((x) => x.id === playerId);
  if (!p) return { message: 'He is not in the academy.', state };
  const team = state.teams.find((t) => t.id === state.managedClubId)!;
  if (team.players.length >= MAX_REGISTERED) return { message: `The first-team squad is full (${MAX_REGISTERED}): sell or release someone first.`, state };
  const cap = freeCap(team.players, p.position);
  const year = seasonYear(state.season);
  const contract = youthContract(p, state.potential[p.id] ?? overall(p), year);
  const round = nextMatchday(state) ?? 0;
  return {
    message: `${p.name} joins the first team on a ${formatMoney(contract.wage)} a season deal until ${contract.until + 1}.`,
    state: {
      ...state,
      teams: state.teams.map((t) => (t.id === team.id ? { ...t, players: [...t.players, { ...p, cap }] } : t)),
      academy: (state.academy ?? []).filter((x) => x.id !== playerId),
      contracts: { ...state.contracts, [p.id]: contract },
      squad: { ...state.squad, [p.id]: { condition: 100 } },
      news: [...state.news, { round, kind: 'training' as const, text: `Academy: ${p.name} (${p.age}, ${p.position}) promoted to the first team.` }].slice(-60),
    },
  };
}

/** Let an academy player go. */
export function releaseYouth(state: CareerState, playerId: string): { message: string; state: CareerState } {
  const p = (state.academy ?? []).find((x) => x.id === playerId);
  if (!p) return { message: 'He is not in the academy.', state };
  return { message: `${p.name} leaves the academy.`, state: { ...state, academy: (state.academy ?? []).filter((x) => x.id !== playerId) } };
}
