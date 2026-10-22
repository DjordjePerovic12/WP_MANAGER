// European club competitions (European Aquatics): Champions League, Euro Cup, Conference Cup
// and Challenger Cup, run like Football Manager's continental cups. Places come from the previous
// season (by country ranking), qualifiers come first, groups are played in midweek, and clubs
// knocked out of one competition drop into the next one down. Formats follow 2026-27
// (docs/research/european-competitions.md), simplified where noted:
//
// Champions League  qualification tournaments (top 2) → 4 groups of 4, home and away (Tuesdays)
//                   → quarter-final round, 2 groups of 4 → Final Four in May.
//                   Qualification 3rd/4th → Euro Cup groups; group 3rd/4th → Euro Cup eighth-finals.
// Euro Cup          qualification tournaments → 4 groups of 4 (Thursdays) → two-legged knockouts.
//                   Qualification losers → Conference Cup qualification round II.
// Conference Cup    qualification rounds I and II (tournaments) → quarter-final round → Final Four.
// Challenger Cup    qualification tournament → Final Eight (2 groups of 4, then a Final Four).
//
// Group games have no draws (penalties: 3/2/1/0 points); knockout ties are two legs on aggregate,
// with penalties after the second leg if level.

import { createRng, type Rng } from '../engine/rng';
import { overall, teamRating } from '../engine/ratings';
import type { Team } from '../engine/types';
import { addDays, type CareerState, type Fixture } from './career';
import { gameWinner, type Series } from './competitions';
import { formatMoney } from './finance';

export type EuroId = 'cl' | 'ec' | 'cc' | 'ch';
export const EURO_IDS: EuroId[] = ['cl', 'ec', 'cc', 'ch'];
export const EURO_NAMES: Record<EuroId, string> = { cl: 'Champions League', ec: 'Euro Cup', cc: 'Conference Cup', ch: 'Challenger Cup' };
export const isEuropean = (competitionId: string) => (EURO_IDS as string[]).includes(competitionId);

/** European Aquatics association ranking 2026-27. Countries not listed rank 13th or lower. */
export const ASSOCIATION_RANKING = ['ITA', 'HUN', 'ESP', 'SRB', 'GRE', 'CRO', 'FRA', 'ROU', 'GER', 'MNE', 'GEO', 'TUR'];
/** Excluded from European competition (from 2027-28 on; the real 2026-27 entries stand). */
const BANNED = ['RUS'];
export const associationRank = (country: string) => {
  const i = ASSOCIATION_RANKING.indexOf(country);
  return i < 0 ? 13 : i + 1;
};

export type PhaseKind = 'tournament' | 'groups' | 'knockout' | 'finalFour';

export interface EuroGroup {
  id: string;
  name: string;
  clubs: string[];
  /** single-venue tournaments: the host club */
  host?: string;
}

export interface EuroPhase {
  id: string;
  comp: EuroId;
  name: string;
  kind: PhaseKind;
  /** tournament/groups: one date per round; knockout: two per round (first and second leg); Final Four: [semi-finals, final] */
  dates: string[];
  entrants: string[];
  /** phases that must be over before the draw */
  sources: string[];
  /** how many go through to `next` */
  target: number;
  next?: string;
  /** clubs finishing in these group places (or all others, 'rest') go to another competition's phase */
  drop?: { phase: string; places: 'rest' | [number, number] };
  status: 'waiting' | 'drawn' | 'done';
  groups?: EuroGroup[];
  ties?: Series[];
  qualified?: string[];
  /** for the knockout draw: the group place each club came from, e.g. "ec-g:1" or "cl-g:4" */
  origin?: Record<string, string>;
}

export interface EuroComp {
  id: EuroId;
  name: string;
  phases: string[];
  championId?: string;
  runnerUpId?: string;
}

export interface EuropeSeason {
  comps: EuroComp[];
  phases: EuroPhase[];
  /** results already paid a win bonus */
  paid?: string[];
}

export interface EuroEntries {
  clDirect: string[];
  clQual: string[];
  ecQual: string[];
  /** clubs that start in the Euro Cup groups (the real 2026-27 Champions League qualification losers) */
  ecGroups: string[];
  ccQ1: string[];
  chQ1: string[];
}

// ---------------------------------------------------------------- prize money (euros)

const PRIZES: Record<EuroId, { entry: number; win: number; stages: Record<string, number>; winner: number; runnerUp: number }> = {
  cl: { entry: 40000, win: 6000, stages: { 'cl-g': 30000, 'cl-qf': 50000, 'cl-f4': 60000 }, winner: 125000, runnerUp: 70000 },
  ec: { entry: 15000, win: 3000, stages: { 'ec-g': 15000, 'ec-ko': 15000 }, winner: 60000, runnerUp: 35000 },
  cc: { entry: 6000, win: 1500, stages: { 'cc-q2': 5000, 'cc-qf': 10000, 'cc-f4': 15000 }, winner: 30000, runnerUp: 15000 },
  ch: { entry: 3000, win: 1000, stages: { 'ch-f8': 5000, 'ch-f4': 8000 }, winner: 15000, runnerUp: 8000 },
};

// ---------------------------------------------------------------- the real 2026-27 season

/** Real 2026-27: the Champions League groups (drawn 21 September) and the clubs already placed. */
const REAL_2026 = {
  clGroups: [
    ['EA-OLY', 'EA-HAN', 'EA-JHN', 'EA-SAB'],
    ['EA-REC', 'EA-RAD', 'EA-BRE', 'EA-ORA'],
    ['EA-BAR', 'EA-MLA', 'EA-NBG', 'EA-JSP'],
    ['EA-FTC', 'EA-MAR', 'EA-PAO', 'EA-STE'],
  ],
  // Champions League qualification 3rd/4th, straight into the Euro Cup groups.
  ecGroups: ['EA-SPA', 'EA-STR', 'EA-SPM', 'EA-BUD', 'EA-HON'],
  ecQual: ['EA-DIN', 'EA-KOT', 'EA-AIX', 'EA-GAL', 'EA-SAV', 'EA-SIN', 'EA-PAR', 'EA-DUI', 'EA-APO', 'EA-SBC', 'EA-ENK', 'EA-WSH', 'EA-JUG', 'EA-POS', 'EA-BCN', 'EA-DIB', 'EA-VOU', 'EA-BDC', 'EA-TER', 'EA-ZUG', 'EA-PRI'],
  ccQ1: ['EA-BAN', 'EA-SOL', 'EA-ZAD', 'EA-MAT', 'EA-OSP', 'EA-SVC', 'EA-PAN', 'EA-YDR', 'EA-SZVE', 'EA-VSC', 'EA-AKK', 'EA-TRI', 'EA-ZVZ', 'EA-VIT', 'EA-HSS'],
};

// ---------------------------------------------------------------- qualification

/**
 * European places from each country's finishing order (best first), per the 2026-27 access rules:
 * - Champions League groups: the champions of associations 1–10 and the Champions League holder.
 * - Champions League qualification: runners-up of 1–10, champions of 11–12, the Euro Cup holder.
 * - Euro Cup qualification: 3rd and 4th of 1–10, runners-up of 11–12, the Conference Cup holder.
 * - Conference Cup: 5th and 6th of 1–10, 3rd–5th of 11–12, champions of 13+, the Challenger Cup holder.
 * - Challenger Cup: 2nd–4th of 13+.
 * Every club takes the best place it is entitled to: a holder's place goes unused when the club
 * already did better through its league (as European Aquatics does), and never pushes it down.
 */
export function allocateEntries(orders: Record<string, string[]>, holders: Partial<Record<EuroId, string>> = {}): EuroEntries {
  // Entitlement levels, best first.
  const LEVELS = ['clDirect', 'clQual', 'ecQual', 'ccQ1', 'chQ1'] as const;
  type Level = (typeof LEVELS)[number];
  const best = new Map<string, Level>();
  const offer = (id: string | undefined, level: Level) => {
    if (!id) return;
    const current = best.get(id);
    if (!current || LEVELS.indexOf(level) < LEVELS.indexOf(current)) best.set(id, level);
  };
  for (const [country, order] of Object.entries(orders)) {
    if (BANNED.includes(country)) continue;
    const rank = associationRank(country);
    const at = (place: number) => order[place - 1];
    if (rank <= 10) {
      offer(at(1), 'clDirect');
      offer(at(2), 'clQual');
      offer(at(3), 'ecQual');
      offer(at(4), 'ecQual');
      offer(at(5), 'ccQ1');
      offer(at(6), 'ccQ1');
    } else if (rank <= 12) {
      offer(at(1), 'clQual');
      offer(at(2), 'ecQual');
      for (const p of [3, 4, 5]) offer(at(p), 'ccQ1');
    } else {
      offer(at(1), 'ccQ1');
      for (const p of [2, 3, 4]) offer(at(p), 'chQ1');
    }
  }
  offer(holders.cl, 'clDirect');
  offer(holders.ec, 'clQual');
  offer(holders.cc, 'ecQual');
  offer(holders.ch, 'ccQ1');
  const e: EuroEntries = { clDirect: [], clQual: [], ecQual: [], ecGroups: [], ccQ1: [], chQ1: [] };
  for (const [id, level] of best) e[level].push(id);
  return e;
}

/** The real 2026-27 entries, limited to the clubs the career knows; Malta's best go to the Challenger Cup. */
export function realEntries2026(exists: (id: string) => boolean, maltaOrder: string[]): EuroEntries {
  const keep = (ids: string[]) => ids.filter(exists);
  return {
    clDirect: keep(REAL_2026.clGroups.flat()),
    clQual: [],
    ecQual: keep(REAL_2026.ecQual),
    ecGroups: keep(REAL_2026.ecGroups),
    ccQ1: keep(REAL_2026.ccQ1),
    chQ1: maltaOrder.slice(0, 4),
  };
}

// ---------------------------------------------------------------- the season's calendar

const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
function onOrAfter(iso: string, day: number) {
  let d = iso;
  while (weekday(d) !== day) d = addDays(d, 1);
  return d;
}
const TUE = 2;
const THU = 4;
const FRI = 5;
const days = (start: string, offsets: number[]) => offsets.map((o) => addDays(start, o));

/**
 * The European season, phase by phase (year = the season's first year). Champions League on
 * Tuesdays, Euro Cup on Thursdays, qualification tournaments Tuesday–Thursday (Friday–Sunday in
 * September, before the leagues start), Final Fours on a Friday and Saturday in spring.
 */
export function europeanCalendar(year: number, entries: EuroEntries, real2026: boolean): EuroPhase[] {
  const y1 = year + 1;
  const tues = (from: string, offsets: number[]) => days(onOrAfter(from, TUE), offsets);
  const thus = (from: string, offsets: number[]) => days(onOrAfter(from, THU), offsets);
  const tournament = (from: string) => days(onOrAfter(from, TUE), [0, 1, 2]);
  const finalFour = (from: string) => days(onOrAfter(from, FRI), [0, 1]);
  const clQualLosers = Math.max(0, entries.clQual.length - Math.max(0, 16 - entries.clDirect.length)) + entries.ecGroups.length;
  const phase = (p: Omit<EuroPhase, 'status' | 'entrants'> & { entrants?: string[] }): EuroPhase => ({ entrants: [], status: 'waiting', ...p });
  return [
    // Champions League
    phase({ id: 'cl-q', comp: 'cl', name: 'Qualification', kind: 'tournament', dates: days(onOrAfter(`${year}-09-15`, FRI), [0, 1, 2]), entrants: entries.clQual, sources: [], target: Math.min(Math.max(0, 16 - entries.clDirect.length), entries.clQual.length), next: 'cl-g', drop: { phase: 'ec-g', places: 'rest' }, ...(real2026 ? { status: 'done' as const, qualified: [] } : {}) }),
    phase({ id: 'cl-g', comp: 'cl', name: 'Group stage', kind: 'groups', dates: tues(`${year}-10-06`, [0, 21, 35, 42, 56, 70]), entrants: entries.clDirect, sources: ['cl-q'], target: 8, next: 'cl-qf', drop: { phase: 'ec-ko', places: [3, 4] } }),
    phase({ id: 'cl-qf', comp: 'cl', name: 'Quarter-final round', kind: 'groups', dates: tues(`${y1}-02-02`, [0, 14, 28, 49, 63, 77]), sources: ['cl-g'], target: 4, next: 'cl-f4' }),
    phase({ id: 'cl-f4', comp: 'cl', name: 'Final Four', kind: 'finalFour', dates: finalFour(`${y1}-05-12`), sources: ['cl-qf'], target: 1 }),
    // Euro Cup
    phase({ id: 'ec-q', comp: 'ec', name: 'Qualification', kind: 'tournament', dates: tournament(`${year}-10-06`), entrants: entries.ecQual, sources: [], target: Math.max(0, Math.min(entries.ecQual.length, 16 - clQualLosers)), next: 'ec-g', drop: { phase: 'cc-q2', places: 'rest' } }),
    phase({ id: 'ec-g', comp: 'ec', name: 'Group stage', kind: 'groups', dates: thus(`${year}-10-22`, [0, 14, 28, 42, 84, 98]), entrants: entries.ecGroups, sources: ['ec-q', 'cl-q'], target: 8, next: 'ec-ko' }),
    phase({ id: 'ec-ko', comp: 'ec', name: 'Knockout', kind: 'knockout', dates: thus(`${y1}-02-18`, [0, 7, 28, 35, 56, 63, 77, 84]), sources: ['ec-g', 'cl-g'], target: 1 }),
    // Conference Cup
    phase({ id: 'cc-q1', comp: 'cc', name: 'Qualification round I', kind: 'tournament', dates: tournament(`${year}-11-10`), entrants: entries.ccQ1, sources: [], target: Math.min(8, entries.ccQ1.length), next: 'cc-q2' }),
    phase({ id: 'cc-q2', comp: 'cc', name: 'Qualification round II', kind: 'tournament', dates: tournament(`${y1}-02-09`), sources: ['cc-q1', 'ec-q'], target: 8, next: 'cc-qf' }),
    phase({ id: 'cc-qf', comp: 'cc', name: 'Quarter-final round', kind: 'tournament', dates: tournament(`${y1}-03-16`), sources: ['cc-q2'], target: 4, next: 'cc-f4' }),
    phase({ id: 'cc-f4', comp: 'cc', name: 'Final Four', kind: 'finalFour', dates: finalFour(`${y1}-04-30`), sources: ['cc-qf'], target: 1 }),
    // Challenger Cup
    phase({ id: 'ch-q1', comp: 'ch', name: 'Qualification', kind: 'tournament', dates: tournament(`${year}-11-24`), entrants: entries.chQ1, sources: [], target: Math.min(8, entries.chQ1.length), next: 'ch-f8' }),
    phase({ id: 'ch-f8', comp: 'ch', name: 'Final Eight', kind: 'tournament', dates: tournament(`${y1}-03-09`), sources: ['ch-q1'], target: 4, next: 'ch-f4' }),
    phase({ id: 'ch-f4', comp: 'ch', name: 'Final Four', kind: 'finalFour', dates: finalFour(`${y1}-03-12`), sources: ['ch-f8'], target: 1 }),
  ];
}

// ---------------------------------------------------------------- draws

type Ctx = { rating: (id: string) => number; country: (id: string) => string | undefined; rng: Rng };

/** Seeded draw into groups: pots by strength, clubs from the same country kept apart where possible. */
function drawGroups(clubs: string[], groupCount: number, ctx: Ctx): string[][] {
  const seeded = [...clubs].sort((a, b) => ctx.rating(b) - ctx.rating(a));
  const groups: string[][] = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < seeded.length; i += groupCount) {
    const pot = seeded.slice(i, i + groupCount);
    for (let k = pot.length - 1; k > 0; k--) {
      const j = Math.floor(ctx.rng.next() * (k + 1));
      [pot[k], pot[j]] = [pot[j], pot[k]];
    }
    for (const club of pot) {
      // The smallest groups first; among those, one without a club from the same country.
      const open = groups.filter((g) => g.length === Math.min(...groups.map((x) => x.length)));
      const target = open.find((g) => !g.some((c) => ctx.country(c) && ctx.country(c) === ctx.country(club))) ?? open[0];
      target.push(club);
    }
  }
  return groups;
}

/** Round robin rounds (the circle method): each round a list of [home, away]. */
function roundRobin(clubs: string[]): [string, string][][] {
  const ids: (string | null)[] = [...clubs];
  if (ids.length % 2) ids.push(null);
  const n = ids.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i];
      const b = ids[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop()!);
  }
  return rounds;
}

const GROUP_LETTERS = 'ABCDEFGH';

function fixture(p: EuroPhase, id: string, stage: string, date: string, homeId: string, awayId: string, extra: Partial<Fixture> = {}): Fixture {
  return { id: `${p.id}-${id}`, competition: p.comp, stage, round: 0, matchday: 0, date, homeId, awayId, phaseId: p.id, ...extra };
}

/** Make the draw for a phase and its first fixtures. */
function drawPhase(p: EuroPhase, ctx: Ctx): { phase: EuroPhase; fixtures: Fixture[] } {
  const clubs = p.entrants;
  if (p.kind === 'tournament' || p.kind === 'groups') {
    // Tournaments: groups of 3–4 at one venue; group stages: groups of 4, home and away.
    const groupCount = p.kind === 'groups' ? Math.max(1, Math.round(clubs.length / 4)) : Math.max(1, Math.ceil(clubs.length / 4));
    const drawn = drawGroups(clubs, groupCount, ctx);
    const groups: EuroGroup[] = drawn.map((g, i) => ({ id: GROUP_LETTERS[i], name: p.kind === 'groups' ? `Group ${GROUP_LETTERS[i]}` : `Tournament ${i + 1}`, clubs: g, host: p.kind === 'tournament' ? g[0] : undefined }));
    const fixtures: Fixture[] = [];
    for (const g of groups) {
      const rounds = roundRobin(g.clubs);
      const all = p.kind === 'groups' ? [...rounds, ...rounds.map((r) => r.map(([h, a]) => [a, h] as [string, string]))] : rounds;
      all.forEach((pairs, r) =>
        pairs.forEach(([h, a], i) => {
          // At a tournament the host plays at home; other games keep the drawn order.
          const [home, away] = g.host && a === g.host ? [a, h] : [h, a];
          fixtures.push(fixture(p, `${g.id}-R${r + 1}-${i + 1}`, `${p.name} · ${g.name}`, p.dates[Math.min(r, p.dates.length - 1)], home, away, { groupId: `${p.id}-${g.id}`, round: r + 1 }));
        }),
      );
    }
    return { phase: { ...p, groups, status: 'drawn' }, fixtures };
  }
  if (p.kind === 'knockout') return openKnockoutRound({ ...p, status: 'drawn' }, 1, clubs, ctx);
  // Final Four: best seed v 4th, 2nd v 3rd.
  const seeded = [...clubs].sort((a, b) => ctx.rating(b) - ctx.rating(a));
  if (seeded.length < 4) {
    // Two or three clubs left (small competitions): the two best seeds play the final.
    return { phase: { ...p, status: 'drawn', ties: [] }, fixtures: seeded.length >= 2 ? [fixture(p, 'F', 'Final Four · Final', p.dates[1], seeded[0], seeded[1])] : [] };
  }
  const fixtures = [fixture(p, 'SF1', 'Final Four · Semi-final', p.dates[0], seeded[0], seeded[3] ?? seeded[2]), ...(seeded.length >= 4 ? [fixture(p, 'SF2', 'Final Four · Semi-final', p.dates[0], seeded[1], seeded[2])] : [])];
  return { phase: { ...p, status: 'drawn' }, fixtures };
}

const KO_NAMES: Record<number, string> = { 2: 'Final', 4: 'Semi-final', 8: 'Quarter-final', 16: 'Eighth-final' };

/**
 * A knockout round: two legs, the better seed at home in the second. In the Euro Cup eighth-finals,
 * Champions League 4th-placed clubs meet Euro Cup group winners and 3rd-placed clubs the runners-up.
 */
function openKnockoutRound(p: EuroPhase, round: number, clubs: string[], ctx: Ctx): { phase: EuroPhase; fixtures: Fixture[] } {
  const strength = (id: string) => {
    const o = p.origin?.[id];
    // Group winners first, then runners-up, then Champions League 3rd, then 4th; strength breaks ties.
    const tier = o === 'ec-g:1' ? 0 : o === 'ec-g:2' ? 1 : o === 'cl-g:3' ? 2 : o === 'cl-g:4' ? 3 : 1.5;
    return round === 1 && p.origin ? -tier * 100 + ctx.rating(id) : ctx.rating(id);
  };
  const seeded = [...clubs].sort((a, b) => strength(b) - strength(a));
  let size = 2;
  while (size < seeded.length) size *= 2;
  const byes = seeded.slice(0, size - seeded.length);
  const playing = seeded.slice(size - seeded.length);
  // Top half against bottom half, drawn at random.
  const top = playing.slice(0, playing.length / 2);
  const bottom = playing.slice(playing.length / 2);
  for (let k = bottom.length - 1; k > 0; k--) {
    const j = Math.floor(ctx.rng.next() * (k + 1));
    [bottom[k], bottom[j]] = [bottom[j], bottom[k]];
  }
  const name = KO_NAMES[size] ?? `Round of ${size}`;
  const ties: Series[] = top.map((home, i) => ({ id: `${p.id}-R${round}-T${i + 1}`, round, homeId: home, awayId: bottom[i], bestOf: 2, wins: [0, 0] }));
  const fixtures = ties.flatMap((t, i) => [
    fixture(p, `R${round}-T${i + 1}-L1`, `${name}, 1st leg`, p.dates[(round - 1) * 2], t.awayId, t.homeId, { seriesId: t.id, leg: 1, round }),
    fixture(p, `R${round}-T${i + 1}-L2`, `${name}, 2nd leg`, p.dates[(round - 1) * 2 + 1], t.homeId, t.awayId, { seriesId: t.id, leg: 2, round }),
  ]);
  return { phase: { ...p, ties: [...(p.ties ?? []), ...ties], qualified: byes.length ? [...(p.qualified ?? []), ...byes] : p.qualified }, fixtures };
}

// ---------------------------------------------------------------- tables and results

export interface GroupRow {
  clubId: string;
  played: number;
  won: number;
  shootoutWon: number;
  shootoutLost: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/** A group's table: 3 points for a win, 2 for a shootout win, 1 for a shootout loss. */
export function groupTable(fixtures: Fixture[], group: EuroGroup, groupId: string, rating: (id: string) => number = () => 0): GroupRow[] {
  const rows = new Map(group.clubs.map((id) => [id, { clubId: id, played: 0, won: 0, shootoutWon: 0, shootoutLost: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }]));
  for (const f of fixtures) {
    if (f.groupId !== groupId || !f.result) continue;
    const [h, a] = f.result.score;
    const winner = gameWinner(f);
    for (const [id, gf, ga] of [[f.homeId, h, a], [f.awayId, a, h]] as const) {
      const r = rows.get(id);
      if (!r) continue;
      r.played++;
      r.goalsFor += gf;
      r.goalsAgainst += ga;
      const won = winner === id;
      if (gf !== ga) won ? (r.won++, (r.points += 3)) : r.lost++;
      else won ? (r.shootoutWon++, (r.points += 2)) : (r.shootoutLost++, (r.points += 1));
    }
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || rating(y.clubId) - rating(x.clubId));
}

/** Penalties after a level two-legged tie: five each, then sudden death. */
function tiePenalties(rng: Rng, home: Team, away: Team): [number, number] {
  const shot = (t: Team) => t.players.filter((p) => p.position !== 'GK').reduce((s, p) => s + p.attrs.shootingAccuracy, 0) / Math.max(1, t.players.length - 2);
  const keeper = (t: Team) => Math.max(...t.players.filter((p) => p.position === 'GK').map((p) => p.attrs.reflexes), 8);
  const chance = (a: Team, d: Team) => Math.max(0.45, Math.min(0.9, 0.7 + (shot(a) - keeper(d)) * 0.02));
  const score: [number, number] = [0, 0];
  for (let i = 0; i < 5; i++) {
    if (rng.chance(chance(home, away))) score[0]++;
    if (rng.chance(chance(away, home))) score[1]++;
  }
  while (score[0] === score[1]) {
    if (rng.chance(chance(home, away))) score[0]++;
    if (rng.chance(chance(away, home))) score[1]++;
  }
  return score;
}

// ---------------------------------------------------------------- moving the competitions on

type Payment = { clubId: string; amount: number; label: string };

function finishGroups(p: EuroPhase, fixtures: Fixture[], ctx: Ctx) {
  const tables = (p.groups ?? []).map((g) => groupTable(fixtures, g, `${p.id}-${g.id}`, ctx.rating));
  // Best `target` clubs: all group winners, then runners-up, and so on (better record first).
  const byPlace: { clubId: string; place: number; row: GroupRow }[] = tables.flatMap((t) => t.map((row, i) => ({ clubId: row.clubId, place: i + 1, row })));
  byPlace.sort((a, b) => a.place - b.place || b.row.points / Math.max(1, b.row.played) - a.row.points / Math.max(1, a.row.played) || b.row.goalsFor - b.row.goalsAgainst - (a.row.goalsFor - a.row.goalsAgainst));
  const qualified = byPlace.slice(0, p.target).map((x) => x.clubId);
  const places = Object.fromEntries(byPlace.map((x) => [x.clubId, x.place]));
  return { qualified, places, rest: byPlace.slice(p.target).map((x) => x.clubId) };
}

/** Move every European competition on after the latest results: draws, next rounds, champions, prize money. */
export function advanceEurope(state: CareerState, teamOf: (id: string) => Team | undefined): CareerState {
  const europe = state.europe;
  if (!europe) return state;
  let phases = europe.phases.map((p) => ({ ...p }));
  let comps = europe.comps.map((c) => ({ ...c }));
  let fixtures = state.fixtures;
  const payments: Payment[] = [];
  const news: string[] = [];
  const mine = state.managedClubId;
  const rating = (id: string) => {
    const t = teamOf(id);
    return t ? teamRating(t.players) : 0;
  };
  const country = (id: string) => state.clubCountries?.[id];
  const nameOf = (id: string) => teamOf(id)?.name ?? id;
  let changed = false;

  for (let pass = 0; pass < 6; pass++) {
    let progress = false;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const comp = comps.find((c) => c.id === p.comp)!;
      const ctx: Ctx = { rating, country, rng: createRng((state.seed ^ hash(`${state.season}/${p.id}/${p.ties?.length ?? 0}`)) >>> 0) };
      const get = (id: string) => phases.find((x) => x.id === id)!;
      const set = (np: EuroPhase) => {
        phases = phases.map((x) => (x.id === np.id ? np : x));
        progress = changed = true;
      };

      if (p.status === 'waiting') {
        if (!p.sources.every((s) => get(s).status === 'done')) continue;
        if (p.entrants.length <= p.target || p.entrants.length < 2) {
          // Nothing to play: everyone goes through (or the competition ends here).
          const done = { ...p, status: 'done' as const, qualified: [...p.entrants] };
          set(done);
          if (p.kind === 'finalFour' && p.entrants.length === 1) comps = comps.map((c) => (c.id === p.comp ? { ...c, championId: p.entrants[0] } : c));
          passOn(done, done.qualified ?? [], []);
          continue;
        }
        const drawn = drawPhase(p, ctx);
        set(drawn.phase);
        fixtures = [...fixtures, ...drawn.fixtures];
        for (const id of p.entrants) if (PRIZES[p.comp].stages[p.id]) payments.push({ clubId: id, amount: PRIZES[p.comp].stages[p.id], label: `${comp.name}: ${p.name}` });
        if (p.entrants.includes(mine)) {
          const g = drawn.phase.groups?.find((x) => x.clubs.includes(mine));
          const tie = drawn.phase.ties?.find((t) => t.homeId === mine || t.awayId === mine);
          const opp = g ? g.clubs.filter((c) => c !== mine).map(nameOf).join(', ') : tie ? nameOf(tie.homeId === mine ? tie.awayId : tie.homeId) : drawn.fixtures.filter((f) => f.homeId === mine || f.awayId === mine).map((f) => nameOf(f.homeId === mine ? f.awayId : f.homeId)).join(', ');
          news.push(`${comp.name} draw · ${p.name}${g ? `, ${g.name}` : ''}: ${opp || 'a bye'}.`);
        }
        continue;
      }
      if (p.status !== 'drawn') continue;
      const own = fixtures.filter((f) => f.phaseId === p.id);

      if (p.kind === 'tournament' || p.kind === 'groups') {
        if (own.some((f) => !f.result)) continue;
        const { qualified, places, rest } = finishGroups(p, fixtures, ctx);
        const done = { ...p, status: 'done' as const, qualified, origin: undefined };
        set(done);
        passOn(done, qualified, rest, places);
        if (p.entrants.includes(mine)) news.push(qualified.includes(mine) ? `${comp.name}: through from the ${p.name.toLowerCase()} (${ordinal(places[mine])} in the group).` : `${comp.name}: out in the ${p.name.toLowerCase()} (${ordinal(places[mine])} in the group).`);
        continue;
      }

      if (p.kind === 'knockout') {
        const round = Math.max(...(p.ties ?? []).map((t) => t.round));
        const ties = (p.ties ?? []).filter((t) => t.round === round);
        if (own.some((f) => f.round === round && !f.result)) continue;
        // Aggregate scores; penalties after a level second leg.
        let updatedTies = p.ties ?? [];
        const winners: string[] = [];
        for (const t of ties) {
          if (t.winnerId) {
            winners.push(t.winnerId);
            continue;
          }
          const legs = own.filter((f) => f.seriesId === t.id);
          const agg = (id: string) => legs.reduce((s, f) => s + (f.homeId === id ? f.result!.score[0] : f.result!.score[1]), 0);
          let winnerId = agg(t.homeId) > agg(t.awayId) ? t.homeId : agg(t.homeId) < agg(t.awayId) ? t.awayId : undefined;
          if (!winnerId) {
            const leg2 = legs.find((f) => f.leg === 2)!;
            const home = teamOf(leg2.homeId);
            const away = teamOf(leg2.awayId);
            const pens = home && away ? tiePenalties(createRng((state.seed ^ hash(leg2.id)) >>> 0), home, away) : ([1, 0] as [number, number]);
            fixtures = fixtures.map((f) => (f.id === leg2.id ? { ...f, result: { ...f.result!, shootout: pens } } : f));
            winnerId = pens[0] > pens[1] ? leg2.homeId : leg2.awayId;
          }
          winners.push(winnerId);
          updatedTies = updatedTies.map((x) => (x.id === t.id ? { ...x, winnerId } : x));
          if (t.homeId === mine || t.awayId === mine) news.push(`${comp.name}: ${winnerId === mine ? 'through' : 'knocked out'} on aggregate against ${nameOf(t.homeId === mine ? t.awayId : t.homeId)}.`);
        }
        const alive = [...winners, ...(round === 1 ? (p.qualified ?? []) : [])];
        if (alive.length === 1) {
          const final = ties[0];
          set({ ...p, ties: updatedTies, status: 'done', qualified: alive });
          comps = comps.map((c) => (c.id === p.comp ? { ...c, championId: alive[0], runnerUpId: final.homeId === alive[0] ? final.awayId : final.homeId } : c));
          payments.push({ clubId: alive[0], amount: PRIZES[p.comp].winner, label: `${comp.name} winners` });
          const runnerUp = final.homeId === alive[0] ? final.awayId : final.homeId;
          payments.push({ clubId: runnerUp, amount: PRIZES[p.comp].runnerUp, label: `${comp.name} runners-up` });
          if (alive[0] === mine) news.push(`🏆 ${comp.name} winners!`);
          continue;
        }
        for (const id of alive) if (PRIZES[p.comp].stages[p.id]) payments.push({ clubId: id, amount: PRIZES[p.comp].stages[p.id], label: `${comp.name}: next round` });
        const opened = openKnockoutRound({ ...p, ties: updatedTies, qualified: [] }, round + 1, alive, ctx);
        set(opened.phase);
        fixtures = [...fixtures, ...opened.fixtures];
        continue;
      }

      // Final Four
      const semis = own.filter((f) => f.id.endsWith('-SF1') || f.id.endsWith('-SF2'));
      const final = own.find((f) => f.id.endsWith('-F'));
      if (semis.some((f) => !f.result)) continue;
      if (!final) {
        const w = semis.map((f) => gameWinner(f)!);
        const l = semis.map((f) => (gameWinner(f) === f.homeId ? f.awayId : f.homeId));
        fixtures = [...fixtures, fixture(p, 'F', 'Final Four · Final', p.dates[1], w[0], w[1] ?? w[0]), ...(l.length === 2 ? [fixture(p, '3RD', 'Final Four · 3rd place', p.dates[1], l[0], l[1])] : [])];
        progress = changed = true;
        continue;
      }
      if (!final.result || own.some((f) => !f.result)) continue;
      const champion = gameWinner(final)!;
      const runnerUp = champion === final.homeId ? final.awayId : final.homeId;
      set({ ...p, status: 'done', qualified: [champion] });
      comps = comps.map((c) => (c.id === p.comp ? { ...c, championId: champion, runnerUpId: runnerUp } : c));
      payments.push({ clubId: champion, amount: PRIZES[p.comp].winner, label: `${comp.name} winners` });
      payments.push({ clubId: runnerUp, amount: PRIZES[p.comp].runnerUp, label: `${comp.name} runners-up` });
      if (champion === mine) news.push(`🏆 ${comp.name} winners!`);
      else if (runnerUp === mine) news.push(`${comp.name}: beaten in the final.`);
    }
    if (!progress) break;
  }

  /** Winners to the next phase, the others (by group place) to another competition. */
  function passOn(p: EuroPhase, qualified: string[], rest: string[], places: Record<string, number> = {}) {
    if (p.next) {
      phases = phases.map((x) => (x.id === p.next ? { ...x, entrants: [...x.entrants, ...qualified.filter((c) => !x.entrants.includes(c))], origin: { ...(x.origin ?? {}), ...Object.fromEntries(qualified.map((c) => [c, `${p.id}:${places[c] ?? 1}`])) } } : x));
    }
    if (p.drop) {
      const [lo, hi] = p.drop.places === 'rest' ? [1, 99] : p.drop.places;
      const going = rest.filter((c) => (places[c] ?? 99) >= lo && (places[c] ?? 0) <= hi);
      phases = phases.map((x) => (x.id === p.drop!.phase ? { ...x, entrants: [...x.entrants, ...going.filter((c) => !x.entrants.includes(c))], origin: { ...(x.origin ?? {}), ...Object.fromEntries(going.map((c) => [c, `${p.id}:${places[c] ?? 0}`])) } } : x));
    }
  }

  // Win bonuses for European results recorded since the last update.
  const paid = new Set(europe.paid ?? []);
  for (const f of fixtures) {
    if (!f.result || !isEuropean(f.competition) || paid.has(f.id)) continue;
    paid.add(f.id);
    const winner = f.leg ? (f.result.score[0] > f.result.score[1] ? f.homeId : f.result.score[0] < f.result.score[1] ? f.awayId : undefined) : gameWinner(f);
    if (winner) payments.push({ clubId: winner, amount: PRIZES[f.competition as EuroId].win, label: `${EURO_NAMES[f.competition as EuroId]}: win bonus` });
    changed = true;
  }
  if (!changed) return state;

  // Prize money for clubs with books (the clubs in the manager's league).
  const finances = { ...state.finances };
  for (const pay of payments) {
    const f = finances[pay.clubId];
    if (!f) continue;
    finances[pay.clubId] = { ...f, balance: f.balance + pay.amount, ledger: pay.clubId === mine ? [...f.ledger, { round: 0, label: pay.label, amount: pay.amount }] : f.ledger };
  }
  for (const pay of payments.filter((x) => x.clubId === mine && x.amount >= 10000 && !x.label.includes('win bonus'))) news.push(`${pay.label}: ${formatMoney(pay.amount)} prize money.`);
  return {
    ...state,
    fixtures,
    finances,
    europe: { comps, phases, paid: [...paid] },
    news: [...state.news, ...news.map((text) => ({ round: 0, kind: 'result' as const, text }))].slice(-60),
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- building a season

/** A new European season: the phases, and the draws that can be made straight away. */
export function buildEurope(state: CareerState, year: number, entries: EuroEntries, teamOf: (id: string) => Team | undefined, real2026 = false): CareerState {
  const phases = europeanCalendar(year, entries, real2026);
  if (real2026) {
    // The real Champions League groups (drawn 21 September 2026).
    const cl = phases.find((p) => p.id === 'cl-g')!;
    const groups = REAL_2026.clGroups.map((g) => g.filter((id) => entries.clDirect.includes(id))).filter((g) => g.length >= 2);
    const drawn: EuroPhase = { ...cl, groups: groups.map((clubs, i) => ({ id: GROUP_LETTERS[i], name: `Group ${GROUP_LETTERS[i]}`, clubs })), status: 'drawn' };
    const fixtures: Fixture[] = [];
    for (const g of drawn.groups!) {
      const rounds = roundRobin(g.clubs);
      [...rounds, ...rounds.map((r) => r.map(([h, a]) => [a, h] as [string, string]))].forEach((pairs, r) =>
        pairs.forEach(([h, a], i) => fixtures.push(fixture(drawn, `${g.id}-R${r + 1}-${i + 1}`, `Group stage · ${g.name}`, drawn.dates[r], h, a, { groupId: `cl-g-${g.id}`, round: r + 1 }))),
      );
    }
    Object.assign(cl, drawn);
    state = { ...state, fixtures: [...state.fixtures, ...fixtures] };
  }
  const comps: EuroComp[] = EURO_IDS.map((id) => ({ id, name: EURO_NAMES[id], phases: phases.filter((p) => p.comp === id).map((p) => p.id) }));
  return advanceEurope({ ...state, europe: { comps, phases, paid: [] }, competitions: [...state.competitions.filter((c) => !isEuropean(c.id)), ...comps.map((c) => ({ id: c.id, name: c.name, kind: 'europe' as const }))] }, teamOf);
}

// ---------------------------------------------------------------- results

/** How far a club went in Europe this season, e.g. "Champions League: Final Four". */
export function europeanResult(state: CareerState, clubId: string): { comp: EuroId; name: string; result: string } | undefined {
  const europe = state.europe;
  if (!europe) return undefined;
  for (const comp of europe.comps) {
    const phases = comp.phases.map((id) => europe.phases.find((p) => p.id === id)!).filter((p) => p.entrants.includes(clubId));
    if (!phases.length) continue;
    if (comp.championId === clubId) return { comp: comp.id, name: comp.name, result: 'Winners' };
    if (comp.runnerUpId === clubId) return { comp: comp.id, name: comp.name, result: 'Runners-up' };
    const last = phases[phases.length - 1];
    // A club that dropped into a lower competition counts there.
    const dropped = europe.comps.some((c) => c.id !== comp.id && EURO_IDS.indexOf(c.id) > EURO_IDS.indexOf(comp.id) && c.phases.some((id) => europe.phases.find((p) => p.id === id)!.entrants.includes(clubId)));
    if (dropped) continue;
    // In knockout rounds, the round itself ("Quarter-final"), from the club's last tie.
    const lastTie = state.fixtures.filter((f) => f.phaseId === last.id && f.seriesId && (f.homeId === clubId || f.awayId === clubId)).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const stage = lastTie ? lastTie.stage.replace(/, (1st|2nd) leg$/, '') : last.name;
    const out = lastTie ? !!last.ties?.find((t) => t.id === lastTie.seriesId && t.winnerId && t.winnerId !== clubId) : last.status === 'done' && !(last.qualified ?? []).includes(clubId);
    return { comp: comp.id, name: comp.name, result: out ? `Out in the ${stage.toLowerCase()}` : stage };
  }
  return undefined;
}

/** Strength of a club for draws: its squad rating (players not known count as average). */
export const clubStrength = (team: Team | undefined) => (team ? teamRating(team.players) : 10);
export const bestPlayerOverall = (team: Team) => Math.max(...team.players.map((p) => overall(p)));

/**
 * Where each league position leads in Europe (single-country leagues): e.g. {1: 'cl', 2: 'cl', 3: 'ec'}.
 * Final positions after the playoffs decide; this is the guide shown next to the table.
 */
export function europeanZones(country: string): Record<number, EuroId> {
  const order = Array.from({ length: 12 }, (_, i) => `#${i + 1}`);
  const e = allocateEntries({ [country]: order });
  const zones: Record<number, EuroId> = {};
  const mark = (ids: string[], comp: EuroId) => ids.forEach((id) => (zones[Number(id.slice(1))] = comp));
  mark([...e.clDirect, ...e.clQual], 'cl');
  mark(e.ecQual, 'ec');
  mark(e.ccQ1, 'cc');
  mark(e.chQ1, 'ch');
  return zones;
}
