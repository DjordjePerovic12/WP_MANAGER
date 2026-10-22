// Knockout competitions: the title playoffs after the regular season and the domestic cup.
//
// Both are brackets of series. A series is one game (cup ties, Final Four games) or a
// best-of-3/5 (playoffs), with the better seed at home in games 1, 3 and 5. Rounds are
// re-seeded: the best seed left meets the worst. Fixtures are created as the bracket
// moves on (game 3 only if a best-of-3 is level), and every knockout game is decided by
// a penalty shootout if level after regular time.

import { createRng } from '../engine/rng';
import { teamRating } from '../engine/ratings';
import { advanceEurope, isEuropean } from './europe';
import {
  addDays,
  clubById,
  leagueTable,
  LEAGUE,
  numberMatchdays,
  type CareerState,
  type Competition,
  type Fixture,
} from './career';
import { leagueDef, type CupFormat, type LeagueDef, type PlayoffFormat } from './leagues';

export interface Series {
  id: string;
  /** 1-based round of the competition */
  round: number;
  /** the better seed: home in games 1, 3 and 5 */
  homeId: string;
  awayId: string;
  bestOf: number;
  /** games won by [home, away] */
  wins: [number, number];
  winnerId?: string;
}

export interface KnockoutRound {
  name: string;
  bestOf: number;
  /** the date of game 1 */
  date: string;
  /** played as a Final Four weekend (semi-finals Saturday, final Sunday) */
  finalFour?: boolean;
}

/** "Final", "Semi-final"... from the number of clubs left. */
export function roundName(clubs: number, first: boolean) {
  if (clubs <= 2) return 'Final';
  if (clubs <= 4) return 'Semi-final';
  if (clubs <= 8) return 'Quarter-final';
  if (clubs <= 16) return first ? 'First round' : 'Eighth-final';
  return 'First round';
}

const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
/** The first date on or after `iso` that falls on a weekday (0 = Sunday ... 6 = Saturday). */
function onOrAfter(iso: string, day: number) {
  let d = iso;
  while (weekday(d) !== day) d = addDays(d, 1);
  return d;
}
const SAT = 6;
const WED = 3;

/** Days after game 1 for games 2–5 of a series: Saturday, Wednesday, Saturday... */
const SERIES_OFFSETS = [0, 4, 7, 11, 14];

const winsNeeded = (bestOf: number) => Math.floor(bestOf / 2) + 1;

const fixtureHome = (s: Series, game: number) => (game % 2 === 1 ? [s.homeId, s.awayId] : [s.awayId, s.homeId]);

/** The fixture for game `game` of a series. */
function seriesFixture(comp: Competition, s: Series, round: KnockoutRound, game: number, semiFinalDate?: string): Fixture {
  const [homeId, awayId] = fixtureHome(s, game);
  const date = round.finalFour ? (semiFinalDate ?? round.date) : addDays(round.date, SERIES_OFFSETS[game - 1]);
  return {
    id: `${s.id}-G${game}`,
    competition: comp.id,
    stage: s.bestOf > 1 ? `${round.name}, game ${game}` : round.name,
    round: s.round,
    matchday: 0,
    date,
    homeId,
    awayId,
    seriesId: s.id,
  };
}

/** Pair clubs best seed against worst, in seed order. */
function pairUp(comp: Competition, round: number, clubs: string[], bestOf: number): Series[] {
  const seeded = [...clubs].sort((a, b) => (comp.seeds?.[a] ?? 99) - (comp.seeds?.[b] ?? 99));
  const out: Series[] = [];
  for (let i = 0; i < seeded.length / 2; i++) {
    out.push({ id: `${comp.id.toUpperCase()}-R${round}-S${i + 1}`, round, homeId: seeded[i], awayId: seeded[seeded.length - 1 - i], bestOf, wins: [0, 0] });
  }
  return out;
}

/** Add a round to a competition: its series and their first games. */
function openRound(comp: Competition, roundIndex: number, clubs: string[], date: string): { comp: Competition; fixtures: Fixture[] } {
  const plan = comp.plan!;
  const spec = plan[roundIndex];
  const round: KnockoutRound = { ...spec, date };
  const series = pairUp(comp, roundIndex + 1, clubs, spec.bestOf);
  const fixtures = series.map((s) => seriesFixture(comp, s, round, 1));
  return { comp: { ...comp, rounds: [...(comp.rounds ?? []), round], series: [...(comp.series ?? []), ...series] }, fixtures };
}

// ---------------------------------------------------------------- setting up a season

type RatedTeam = { id: string; players: Parameters<typeof teamRating>[0] };

/** Playoff rounds for a format, sized down if fewer clubs take part (e.g. 4 Montenegrin clubs). */
function playoffPlan(format: PlayoffFormat, clubs: number): Omit<KnockoutRound, 'date'>[] {
  let teams = format.teams;
  while (teams > clubs && teams > 2) teams /= 2;
  const rounds = format.bestOf.slice(format.bestOf.length - Math.log2(teams));
  return rounds.map((bestOf, i) => {
    const left = teams / 2 ** i;
    return { name: roundName(left, false), bestOf, finalFour: format.finalFour && left <= 4 };
  });
}

/**
 * A cup: every club given, seeded by squad strength (with a little luck), top seeds with byes.
 * Winter timing: rounds on Wednesdays from mid-October, Final Four on the first weekend of the
 * winter break. After the league (Malta): a round every two days.
 */
function makeCup(id: string, name: string, format: CupFormat, teams: RatedTeam[], year: number, seed: number, leagueEnd?: string) {
  const rng = createRng((seed ^ 0xc0b) >>> 0);
  const ranked = [...teams].sort((a, b) => teamRating(b.players) + rng.range(-0.3, 0.3) - (teamRating(a.players) + rng.range(-0.3, 0.3)));
  const seeds = Object.fromEntries(ranked.map((t, i) => [t.id, i + 1]));
  let size = 2;
  while (size < teams.length) size *= 2;
  const plan: Omit<KnockoutRound, 'date'>[] = [];
  for (let clubs = size; clubs >= 2; clubs /= 2) plan.push({ name: roundName(clubs, clubs === size && size > 8), bestOf: 1, finalFour: clubs <= 4 });
  const early = plan.filter((r) => !r.finalFour).length;
  let dates: string[];
  if (format.timing === 'afterLeague' && leagueEnd) {
    let d = addDays(leagueEnd, 2);
    dates = plan.map((r, i) => {
      if (i > 0) d = addDays(d, r.name === 'Final' && plan[i - 1].finalFour ? 1 : 2);
      return d;
    });
  } else {
    const finalFour = onOrAfter(`${year}-12-27`, SAT);
    const firstWed = onOrAfter(`${year}-10-14`, WED);
    dates = plan.map((r, i) => (r.finalFour ? (r.name === 'Final' && plan.length > 1 && plan[i - 1].finalFour ? addDays(finalFour, 1) : finalFour) : addDays(firstWed, 21 * i)));
  }
  const byes = size - teams.length;
  const cup: Competition = { id, name, kind: 'cup', plan, seeds, roundDates: dates, clubs: teams.map((t) => t.id), byes: ranked.slice(0, byes).map((t) => t.id) };
  return early > 0 || size <= 4 ? openRound(cup, 0, ranked.slice(byes).map((t) => t.id), dates[0]) : { comp: cup, fixtures: [] as Fixture[] };
}

/**
 * The knockout competitions of a season: the league playoffs (seeded from the final table, opened
 * when the regular season ends), the cup, and in a multi-country league (the VRL) each country's
 * championship (after the league playoffs) and national cup.
 */
export function knockoutCompetitions(league: LeagueDef, teams: RatedTeam[], year: number, seed: number, leagueEnd?: string, countryOf: (clubId: string) => string | undefined = () => undefined) {
  const competitions: Competition[] = [{ id: 'playoffs', name: `${league.name} playoffs`, title: league.name, kind: 'playoff', plan: playoffPlan(league.playoffs, teams.length) }];
  const fixtures: Fixture[] = [];
  if (league.cup) {
    const cup = makeCup('cup', league.cup.name, league.cup, teams, year, seed, leagueEnd);
    competitions.push(cup.comp);
    fixtures.push(...cup.fixtures);
  }
  for (const nat of league.national ?? []) {
    const clubs = teams.filter((t) => countryOf(t.id) === nat.country);
    if (clubs.length < 2) continue;
    if (nat.playoffs)
      competitions.push({ id: `playoffs-${nat.country}`, name: nat.name, title: nat.name, kind: 'playoff', clubs: clubs.map((t) => t.id), after: 'playoffs', plan: playoffPlan(nat.playoffs, clubs.length) });
    if (nat.cup) {
      const cup = makeCup(`cup-${nat.country}`, nat.cup.name, nat.cup, clubs, year, (seed ^ nat.country.charCodeAt(0)) >>> 0, leagueEnd);
      competitions.push(cup.comp);
      fixtures.push(...cup.fixtures);
    }
  }
  return { competitions, fixtures };
}

// ---------------------------------------------------------------- moving the brackets on

/** Brackets after the latest results: series wins, next games, next rounds, champions. */
export function advanceCompetitions(state: CareerState): CareerState {
  // One competition can unlock another (the Maltese playoffs wait for the cup): repeat until settled.
  let current = state;
  for (let i = 0; i < 6; i++) {
    let next = advanceOnce(current);
    next = advanceEurope(next, (id) => clubById(next, id));
    if (next === current) break;
    current = next;
  }
  if (current === state) return state;
  return { ...current, fixtures: numberMatchdays(resolveClashes(current.fixtures)) };
}

/**
 * No club plays twice on one day. European games keep their dates; a domestic game that clashes
 * (say a playoff game on a Final Four weekend) moves back a day at a time until both clubs are free.
 */
export function resolveClashes(fixtures: Fixture[]): Fixture[] {
  const busy = new Map<string, Set<string>>();
  const mark = (f: Fixture) => {
    for (const id of [f.homeId, f.awayId]) busy.set(id, (busy.get(id) ?? new Set()).add(f.date));
  };
  const european = (f: Fixture) => isEuropean(f.competition);
  // Played games and European games are fixed; the league before playoffs before cups.
  const priority = (f: Fixture) => (f.result ? 0 : european(f) ? 1 : f.competition === LEAGUE ? 2 : f.competition.startsWith('playoffs') ? 3 : 4);
  const order = [...fixtures].sort((a, b) => priority(a) - priority(b) || a.date.localeCompare(b.date));
  const moved = new Map<string, string>();
  for (const f of order) {
    let date = f.date;
    if (priority(f) >= 2) while (busy.get(f.homeId)?.has(date) || busy.get(f.awayId)?.has(date)) date = addDays(date, 1);
    if (date !== f.date) moved.set(f.id, date);
    mark({ ...f, date });
  }
  return moved.size ? fixtures.map((f) => (moved.has(f.id) ? { ...f, date: moved.get(f.id)! } : f)) : fixtures;
}

function advanceOnce(state: CareerState): CareerState {
  let fixtures = state.fixtures;
  let changed = false;
  const competitions = state.competitions.map((input) => {
    if (input.kind !== 'playoff' && input.kind !== 'cup') return input;
    let comp = input;
    if (comp.championId) return comp;

    // Playoffs start once the regular season is over, and after the competitions they wait for:
    // the cup where it comes after the league (Malta), the league playoffs for national championships (VRL).
    if (comp.kind === 'playoff' && !comp.series) {
      const league = fixtures.filter((f) => f.competition === LEAGUE);
      if (!league.length || league.some((f) => !f.result)) return comp;
      const cupAfter = leagueDef(state.leagueId).cup?.timing === 'afterLeague' ? state.competitions.find((c) => c.id === 'cup') : undefined;
      const waitFor = [cupAfter?.id, comp.after].filter((x): x is string => !!x).map((id) => state.competitions.find((c) => c.id === id)!).filter(Boolean);
      if (waitFor.some((c) => !c.championId)) return comp;
      const plan = comp.plan!;
      const qualifiers = leagueTable(state)
        .filter((r) => !comp.clubs || comp.clubs.includes(r.clubId))
        .slice(0, 2 ** plan.length)
        .map((r) => r.clubId);
      comp = { ...comp, seeds: Object.fromEntries(qualifiers.map((id, i) => [id, i + 1])) };
      const last = [...league, ...fixtures.filter((f) => waitFor.some((c) => c.id === f.competition))].map((f) => f.date).sort().at(-1)!;
      const opened = openRound(comp, 0, qualifiers, cupAfter ? addDays(last, 3) : onOrAfter(addDays(last, waitFor.length ? 4 : 7), SAT));
      fixtures = [...fixtures, ...opened.fixtures];
      changed = true;
      return opened.comp;
    }
    if (!comp.series) return comp;

    // Series wins from the results.
    const series = comp.series.map((s) => {
      if (s.winnerId) return s;
      const games = fixtures.filter((f) => f.seriesId === s.id && f.result);
      const wins: [number, number] = [0, 0];
      for (const g of games) {
        const winner = gameWinner(g);
        if (winner === s.homeId) wins[0]++;
        else if (winner === s.awayId) wins[1]++;
      }
      const need = winsNeeded(s.bestOf);
      const winnerId = wins[0] >= need ? s.homeId : wins[1] >= need ? s.awayId : undefined;
      if (wins[0] !== s.wins[0] || wins[1] !== s.wins[1] || winnerId) changed = true;
      return { ...s, wins, winnerId };
    });
    comp = { ...comp, series };

    const roundNo = Math.max(...series.map((s) => s.round));
    const current = series.filter((s) => s.round === roundNo);
    const round = comp.rounds![roundNo - 1];
    // Undecided series with no game waiting: schedule the next game.
    for (const s of current) {
      if (s.winnerId) continue;
      const pending = fixtures.some((f) => f.seriesId === s.id && !f.result);
      if (pending) continue;
      const game = s.wins[0] + s.wins[1] + 1;
      fixtures = [...fixtures, seriesFixture(comp, s, round, game)];
      changed = true;
    }
    if (current.some((s) => !s.winnerId)) return comp;

    // Round over: a champion, or the next round.
    const winners = current.map((s) => s.winnerId!);
    if (winners.length === 1) {
      changed = true;
      const final = current[0];
      return { ...comp, championId: final.winnerId, runnerUpId: final.winnerId === final.homeId ? final.awayId : final.homeId };
    }
    const next = roundNo; // index of the next round in the plan
    const clubs = roundNo === 1 && comp.byes?.length ? [...comp.byes, ...winners] : winners;
    const lastGame = fixtures.filter((f) => f.competition === comp.id).map((f) => f.date).sort().at(-1)!;
    const plannedDate = comp.roundDates?.[next];
    const spec = comp.plan![next];
    // Final Four: semi-finals on Saturday, the final on Sunday.
    if (spec.finalFour && round.finalFour) {
      const opened = openRound(comp, next, clubs, addDays(round.date, 1));
      fixtures = [...fixtures, ...opened.fixtures];
      changed = true;
      return opened.comp;
    }
    const date = plannedDate && plannedDate > lastGame ? plannedDate : onOrAfter(addDays(lastGame, 3), SAT);
    const opened = openRound(comp, next, clubs, date);
    fixtures = [...fixtures, ...opened.fixtures];
    changed = true;
    return opened.comp;
  });
  if (!changed) return state;
  return { ...state, competitions, fixtures: numberMatchdays(fixtures) };
}

/** Who won a knockout game (penalties if level). */
export function gameWinner(f: Fixture): string | undefined {
  if (!f.result) return undefined;
  const [h, a] = f.result.score;
  if (h !== a) return h > a ? f.homeId : f.awayId;
  const so = f.result.shootout;
  if (so) return so[0] > so[1] ? f.homeId : f.awayId;
  return undefined;
}

// ---------------------------------------------------------------- results

/**
 * The season's final order: the playoff champion first, then the runner-up, then clubs by
 * the round they went out in (league position breaks ties), then everyone else by league position.
 * Before the playoffs are over (or for older saves without them) it is the league table.
 */
export function finalStandings(state: CareerState, competitionId = 'playoffs', clubs?: string[]): string[] {
  const table = leagueTable(state)
    .map((r) => r.clubId)
    .filter((id) => !clubs || clubs.includes(id));
  const playoffs = state.competitions.find((c) => c.id === competitionId);
  if (!playoffs?.series?.length) return table;
  const reached = (id: string) => {
    if (playoffs.championId === id) return 99;
    const mine = playoffs.series!.filter((s) => s.homeId === id || s.awayId === id);
    return mine.length ? Math.max(...mine.map((s) => s.round)) : 0;
  };
  return [...table].sort((a, b) => reached(b) - reached(a) || table.indexOf(a) - table.indexOf(b));
}

/** How far a club went in a knockout competition: "Winners", "Final", "Semi-final"... or undefined if not in it. */
export function knockoutResult(state: CareerState, competitionId: string, clubId: string): string | undefined {
  const comp = state.competitions.find((c) => c.id === competitionId);
  if (!comp?.series) return undefined;
  if (comp.championId === clubId) return 'Winners';
  const mine = comp.series.filter((s) => s.homeId === clubId || s.awayId === clubId);
  if (!mine.length) return comp.kind === 'playoff' ? 'Did not qualify' : undefined;
  const last = mine.reduce((a, b) => (b.round > a.round ? b : a));
  const name = comp.rounds?.[last.round - 1]?.name ?? `Round ${last.round}`;
  return last.winnerId && last.winnerId !== clubId ? (name === 'Final' ? 'Runners-up' : `Out in the ${name.toLowerCase()}`) : name === 'Final' ? 'Final' : name;
}

/** The managed club's trophies this season (names of competitions won). */
export function trophiesWon(state: CareerState): string[] {
  return state.competitions.filter((c) => c.championId === state.managedClubId).map((c) => c.title ?? c.name);
}

/** Does a club take part in a competition? */
export const takesPart = (comp: Competition, clubId: string) => !comp.clubs || comp.clubs.includes(clubId);

export const isKnockout = (state: CareerState, f: Fixture) => !!f.seriesId || state.competitions.find((c) => c.id === f.competition)?.kind !== 'league';
