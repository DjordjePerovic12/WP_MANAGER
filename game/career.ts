// Career mode: one league season for a club the user manages.
//
// Pure functions over a plain CareerState object (easy to save as JSON):
// create a career, find the next round, record or simulate matches, and read
// the league table and statistics. Functions never mutate their input.

import { boxScore } from '../engine/stats';
import { matchRatings } from '../engine/performance';
import { createRng } from '../engine/rng';
import { DEFAULT_TACTICS } from '../engine/generate';
import { simulateMatch } from '../engine/match';
import type { Attributes, MatchOptions, MatchResult, Player, Tactics, Team } from '../engine/types';
import { overall } from '../engine/ratings';
import { ADRIATIC_CLUB_COUNTRIES, generatedClub, isRealClub, type LeagueDef } from './leagues';
import { advanceCompetitions, knockoutCompetitions, resolveClashes, type KnockoutRound, type Series } from './competitions';
import { academyWeek, freeCap, initialAcademy, youthContract } from './academy';
import { buildEurope, realEntries2026, type EuropeSeason } from './europe';
import { boardExpectation, initialPotential, MIN_SQUAD, START_SQUAD, youthIntake } from './development';
import type { SeasonRecord, PlayerSeasonEntry, SummerReport } from './seasons';
import type { Bid, IncomingOffer, TransferRecord } from './transfers';
import { trainingWeek, type IndividualFocus, type TrainingReport } from './training';
import { teamRating } from '../engine/ratings';
import type { ScoutReport } from './scouting';
import { assistantFormBonus, initialStaff, staffMarket, staffWages, type StaffMember, type StaffRole } from './staff';
import {
  type ClubFinances,
  expectedWage,
  initialContracts,
  initialFinances,
  renewalDemand,
  respondToOffer,
  roundFinances,
  wageBill,
  wageBudgetRange,
  type Contract,
  type FreeAgent,
  type RenewalDemand,
} from './finance';
import {
  conditionAfterMatch,
  DEFAULT_MORALE,
  DEFAULT_TRAINING,
  matchInjuries,
  moraleAfter,
  moraleBonus,
  pickMatchday,
  validStarters,
  type NewsItem,
  type PlayerCondition,
  type Selection,
  type Training,
} from './squad';

export const CAREER_VERSION = 10;
const NEWS_KEPT = 60;
export const SEASON = '2026-27';

/** "2026-27" → 2026 */
export const seasonYear = (season: string) => Number(season.slice(0, 4));
/** 2027 → "2027-28" */
export const seasonLabel = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, '0')}`;

/** The first Saturday of October in a season's first year. */
export function seasonStart(year: number) {
  const d = new Date(Date.UTC(year, 9, 1, 12));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** League points: no draws since v10 (level games go to penalties); older saves may still have draws. */
const POINTS = { win: 3, shootoutWin: 2, shootoutLoss: 1, draw: 1, loss: 0 };

export interface FixtureResult {
  score: [number, number];
  quarterScores: [number, number][];
  seed: number;
  /** goals per player in this match */
  scorers: { playerId: string; goals: number }[];
  played: 'live' | 'simulated';
  /** penalty shootout after a level game: [home, away] */
  shootout?: [number, number];
  manOfTheMatch?: string;
}

/** The competitions of a season. Only the league for now; playoffs, cups and Europe come later. */
export type CompetitionKind = 'league' | 'playoff' | 'cup' | 'europe';
export interface Competition {
  id: string;
  name: string;
  kind: CompetitionKind;
  /** knockout competitions: the rounds to play (names, games per series, Final Four) */
  plan?: Omit<KnockoutRound, 'date'>[];
  /** the rounds opened so far, with their dates */
  rounds?: KnockoutRound[];
  /** planned dates of each round's first games (the cup's fixed calendar) */
  roundDates?: string[];
  /** seed per club: 1 is the best */
  seeds?: Record<string, number>;
  /** clubs that skip the first round */
  byes?: string[];
  series?: Series[];
  championId?: string;
  runnerUpId?: string;
  /** the clubs taking part (all league clubs when unset) */
  clubs?: string[];
  /** a competition that has to finish first (national championships wait for the league playoffs) */
  after?: string;
  /** what the winner wins, e.g. "VRL Premier League" for the league playoffs */
  title?: string;
}
export const LEAGUE = 'league';

export interface Fixture {
  id: string;
  /** competition id (see CareerState.competitions) */
  competition: string;
  /** label within the competition: "Round 7", "Semi-final, game 2" */
  stage: string;
  /** round number within the competition */
  round: number;
  /** step in the season calendar: every date with matches is one matchday, in order */
  matchday: number;
  date: string; // ISO yyyy-mm-dd
  homeId: string;
  awayId: string;
  /** knockout games: the series (tie) this game belongs to */
  seriesId?: string;
  /** European games: the phase, the group, and the leg of a two-legged tie */
  phaseId?: string;
  groupId?: string;
  leg?: 1 | 2;
  result?: FixtureResult;
}

export interface PlayerSeason {
  /** goals conceded while in goal (goalkeepers) */
  conceded?: number;
  /** match ratings this season: their sum and how many (average = ratingSum / rated) */
  ratingSum?: number;
  rated?: number;
  /** man of the match awards */
  mom?: number;
  apps: number;
  goals: number;
  shots: number;
  assists: number;
  exclusionsDrawn: number;
  fouls: number;
  saves: number;
  minutes: number;
}

export interface CareerState {
  version: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  season: string;
  leagueId: string;
  leagueName: string;
  managedClubId: string;
  seed: number;
  /** every club in the league, with full squads (a snapshot, so the save never depends on the database) */
  teams: Team[];
  /** ids of generated (fictional) clubs */
  generated: string[];
  /** the competitions this season (the league first) */
  competitions: Competition[];
  /** each club's country (IOC code), for national competitions in multi-country leagues */
  clubCountries?: Record<string, string>;
  /** clubs outside the manager's league (for European competitions), with full squads */
  foreign?: Team[];
  /** this season's European competitions */
  europe?: EuropeSeason;
  /** the manager's youth academy (15–19-year-olds), not part of the first team */
  academy?: Player[];
  /** youth training progress toward the next attribute point, per academy player */
  academyProgress?: Record<string, number>;
  fixtures: Fixture[];
  playerStats: Record<string, PlayerSeason>;
  /** the manager's tactics for their own team */
  tactics: Tactics;
  /** fitness and injuries of every player in the league */
  squad: Record<string, PlayerCondition>;
  /** the managed club's weekly training */
  training: Training;
  /** team morale per club (0–100) */
  morale: Record<string, number>;
  /** the manager's matchday squad and starting seven (the assistant fills gaps) */
  selection?: Selection;
  /** training progress toward the next attribute point, per player */
  progress: Record<string, Partial<Record<keyof Attributes, number>>>;
  /** latest news about the managed club, newest last */
  news: NewsItem[];
  /** hidden potential (the overall rating each player can grow to) */
  potential: Record<string, number>;
  /** where the board expects the managed club to finish this season */
  expectation: number;
  /** past seasons, oldest first */
  history: SeasonRecord[];
  /** each player's past seasons */
  playerHistory: Record<string, PlayerSeasonEntry[]>;
  /** what happened in the last summer break (shown at the start of a new season) */
  summer?: SummerReport;
  /** personal training focus per player of the managed club (default: the team plan) */
  individual: Record<string, IndividualFocus>;
  /** the latest weekly training report for the managed club */
  trainingReport?: TrainingReport;
  /** recent training ratings per player (newest last) */
  trainingRatings: Record<string, number[]>;
  /** every player's contract */
  contracts: Record<string, Contract>;
  /** every club's money */
  finances: Record<string, ClubFinances>;
  /** players without a club */
  freeAgents: FreeAgent[];
  /** contract talks this season with the manager's players */
  negotiations: Record<string, { attempts: number; closed?: boolean }>;
  /** bids and personal-terms talks in the current transfer window */
  bids: Record<string, Bid>;
  bidsWindow?: string;
  /** the manager's players up for sale */
  transferList: string[];
  /** clubs' offers for the manager's players */
  offers: IncomingOffer[];
  /** every transfer in the league */
  transfers: TransferRecord[];
  /** the managed club's backroom staff */
  staff: Partial<Record<StaffRole, StaffMember>>;
  /** coaches and scouts available to hire this season */
  staffMarket: StaffMember[];
  /** scouting reports on players outside the club */
  scouting: Record<string, ScoutReport>;
  /** reports used this week */
  scoutingUsed?: { week: string; count: number };
  /** match-by-match lines this season for the managed club's players */
  matchLog: Record<string, MatchLogEntry[]>;
}

export interface MatchLogEntry {
  /** the competition round (older saves: the league round) */
  round: number;
  matchday?: number;
  competition?: string;
  stage?: string;
  date: string;
  opponentId: string;
  home: boolean;
  /** [club, opponent] */
  score: [number, number];
  minutes: number;
  goals: number;
  shots: number;
  assists: number;
  exclusionsDrawn: number;
  fouls: number;
  saves: number;
  conceded: number;
  /** rating out of 10 */
  rating?: number;
  /** penalty shootout after a level game: [club, opponent] */
  shootout?: [number, number];
  /** man of the match */
  mom?: boolean;
}

/** Staff for a managed club, with income and budget raised to pay for them (the club already employed them). */
function withStaff(seed: number, teams: Team[], managedClubId: string, finances: Record<string, ClubFinances>, season: string) {
  const team = teams.find((t) => t.id === managedClubId)!;
  const staff = initialStaff(seed, teamRating(team.players));
  const cost = staffWages(staff);
  const f = finances[managedClubId];
  return {
    staff,
    staffMarket: staffMarket(seed, season),
    finances: { ...finances, [managedClubId]: { ...f, revenue: f.revenue + cost, wageBudget: f.wageBudget + cost } },
  };
}

export function potentials(teams: Team[], seed: number): Record<string, number> {
  const rng = createRng((seed ^ 0x9071) >>> 0);
  return Object.fromEntries(teams.flatMap((t) => t.players.map((p) => [p.id, initialPotential(p, rng)])));
}

export interface TableRow {
  clubId: string;
  played: number;
  /** wins in regular time */
  won: number;
  /** level after regular time, won on penalties (2 points) */
  shootoutWon: number;
  /** level after regular time, lost on penalties (1 point) */
  shootoutLost: number;
  /** draws (older saves only) */
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** last five results, most recent last (a shootout counts as W or L) */
  form: ('W' | 'D' | 'L')[];
}

// ---------------------------------------------------------------- creation

/**
 * Start a career. `realTeams` are the league's real clubs; generated clubs are
 * added until the league reaches its size.
 */
export function createCareer(options: {
  league: LeagueDef;
  realTeams: Team[];
  managedClubId: string;
  seed?: number;
  id?: string;
  now?: string;
  /** IOC country per real club (from the data); generated clubs get the league's first country */
  countries?: Record<string, string>;
  /** every real club (the rest of Europe, for European competitions) */
  world?: Team[];
}): CareerState {
  const { league, realTeams, managedClubId } = options;
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = createRng(seed);
  if (!realTeams.some((t) => t.id === managedClubId)) throw new Error(`Club ${managedClubId} is not in ${league.name}`);

  const missing = Math.max(0, league.size - realTeams.length);
  const generatedTeams = league.fillerNames.filter((f) => !isRealClub(f, realTeams)).slice(0, missing).map(([name, short], i) => {
    const [lo, hi] = league.fillerQuality;
    const quality = hi - ((hi - lo) * i) / Math.max(1, missing - 1);
    return generatedClub(rng, `GEN-${league.id}-${short}`, name, short, quality);
  });
  const allTeams = fixAges([...realTeams, ...generatedTeams].map((t) => ({ ...t, tactics: { ...DEFAULT_TACTICS, ...t.tactics } })));
  const allPotential = potentials(allTeams, seed);
  // Real rosters list every registered youngster: keep each club's best 20, the rest start as free agents.
  const surplus: { player: Player; fromClubId: string }[] = [];
  const teams = allTeams.map((t) => {
    if (t.players.length <= START_SQUAD) return t;
    const worth = (p: Player) => overall(p) + Math.max(0, (allPotential[p.id] ?? 0) - overall(p)) * 0.5;
    const keepers = t.players.filter((p) => p.position === 'GK').sort((a, b) => worth(b) - worth(a)).slice(0, 3);
    const field = t.players.filter((p) => p.position !== 'GK').sort((a, b) => worth(b) - worth(a));
    const kept = [...keepers, ...field.slice(0, START_SQUAD - keepers.length)];
    for (const p of t.players) if (!kept.includes(p)) surplus.push({ player: p, fromClubId: t.id });
    return { ...t, players: t.players.filter((p) => kept.includes(p)) };
  });
  const now = options.now ?? new Date().toISOString();
  const clubCountries = Object.fromEntries(teams.map((t) => [t.id, options.countries?.[t.id] ?? ADRIATIC_CLUB_COUNTRIES[t.id] ?? league.countries[0]]));
  const career: CareerState = {
    version: CAREER_VERSION,
    id: options.id ?? `career-${seed}`,
    createdAt: now,
    updatedAt: now,
    season: SEASON,
    leagueId: league.id,
    leagueName: league.name,
    managedClubId,
    seed,
    teams,
    generated: generatedTeams.map((t) => t.id),
    clubCountries,
    ...seasonFixtures(league, teams, seed, seasonYear(SEASON), seasonStart(seasonYear(SEASON)), clubCountries),
    playerStats: {},
    tactics: { ...teams.find((t) => t.id === managedClubId)!.tactics },
    squad: Object.fromEntries(teams.flatMap((t) => t.players.map((p) => [p.id, { condition: 100 }]))),
    training: { ...DEFAULT_TRAINING },
    morale: Object.fromEntries(teams.map((t) => [t.id, DEFAULT_MORALE])),
    progress: {},
    news: [],
    potential: allPotential,
    expectation: boardExpectation(teams, managedClubId),
    history: [],
    playerHistory: {},
    individual: {},
    trainingRatings: {},
    ...moneyFor(teams, seed, seasonYear(SEASON), allPotential),
    freeAgents: surplus.map(({ player, fromClubId }) => ({ player, fromClubId, potential: allPotential[player.id], askingWage: expectedWage(player, allPotential[player.id]) })),
    negotiations: {},
    bids: {},
    transferList: [],
    offers: [],
    transfers: [],
    scouting: {},
    matchLog: {},
    ...(() => {
      const money = moneyFor(teams, seed, seasonYear(SEASON), allPotential);
      return { ...money, ...withStaff(seed, teams, managedClubId, money.finances, SEASON) };
    })(),
  };
  const withWorld = attachWorld(withAcademy(career), options.world ?? [], options.countries ?? {});
  // The first season: the real 2026-27 European entries (Champions League groups already drawn).
  if (!withWorld.foreign?.length) return withWorld;
  const exists = (id: string) => !!clubById(withWorld, id);
  const malta = allClubs(withWorld).filter((t) => withWorld.clubCountries?.[t.id] === 'MLT').sort((a, b) => teamRating(b.players) - teamRating(a.players)).map((t) => t.id);
  const europe = buildEurope(withWorld, seasonYear(SEASON), realEntries2026(exists, malta), (id) => clubById(withWorld, id), true);
  return { ...europe, fixtures: numberMatchdays(resolveClashes(europe.fixtures)) };
}

/**
 * Give a career the rest of Europe: every real club outside its league, with its country, so
 * European competitions have opponents. Older saves get it when they are opened.
 */
export function attachWorld(state: CareerState, world: Team[], countries: Record<string, string>): CareerState {
  if (state.foreign || !world.length) return state;
  const league = new Set(state.teams.map((t) => t.id));
  const foreign = fixAges(world.filter((t) => !league.has(t.id) && t.players.length >= 7).map((t) => ({ ...t, tactics: { ...DEFAULT_TACTICS, ...t.tactics } })));
  const potential = { ...potentials(foreign, state.seed ^ 0xe0), ...state.potential };
  const clubCountries = { ...Object.fromEntries(foreign.map((t) => [t.id, countries[t.id]]).filter(([, c]) => c)), ...(state.clubCountries ?? {}) };
  return { ...state, foreign, potential, clubCountries };
}

/** Give a career its youth academy (new careers, and older saves that had none). */
function withAcademy(state: CareerState): CareerState {
  if (state.academy) return state;
  const intake = initialAcademy(state);
  return { ...state, academy: intake.map((i) => i.player), academyProgress: {}, potential: { ...state.potential, ...Object.fromEntries(intake.map((i) => [i.player.id, i.potential])) } };
}

export function moneyFor(teams: Team[], seed: number, year: number, potential: Record<string, number>) {
  const contracts = initialContracts(teams, seed, year, potential);
  return { contracts, finances: initialFinances(teams, contracts, seed) };
}

/** Bring an older save up to date. */
/** Players with an impossible age (typos in the source data) get a typical one. */
function fixAges(teams: Team[]): Team[] {
  if (!teams.some((t) => t.players.some((p) => p.age < 14 || p.age > 50))) return teams;
  return teams.map((t) => ({ ...t, players: t.players.map((p) => (p.age < 14 || p.age > 50 ? { ...p, age: 24 } : p)) }));
}

export function migrateCareer(state: CareerState): CareerState {
  return ensureSquads(withYouthStaffMarket(withAcademy(upgradeSave(state))));
}

/** Saves from before the Head of Youth Development role get candidates for it this season. */
function withYouthStaffMarket(state: CareerState): CareerState {
  if (!state.staffMarket || state.staffMarket.some((m) => m.role === 'youth')) return state;
  return { ...state, staffMarket: [...state.staffMarket, ...staffMarket(state.seed, state.season).filter((m) => m.role === 'youth')] };
}

/**
 * Every club needs a squad it can play with. When a club is down to fewer than 13 players or
 * 2 goalkeepers (contracts ran out, players sold or released), it calls up academy youngsters.
 */
export function ensureSquads(state: CareerState): CareerState {
  const short = state.teams.filter((t) => t.players.length < MIN_SQUAD || t.players.filter((p) => p.position === 'GK').length < 2);
  if (!short.length) return state;
  const year = seasonYear(state.season);
  const contracts = { ...state.contracts };
  const potential = { ...state.potential };
  const squad = { ...state.squad };
  const news = [...state.news];
  let academy = state.academy ?? [];
  const teams = state.teams.map((team) => {
    if (!short.includes(team)) return team;
    let h = (state.seed ^ year) >>> 0;
    for (const ch of team.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rng = createRng(h);
    let players = [...team.players];
    const called: string[] = [];
    const gks = () => players.filter((p) => p.position === 'GK').length;
    const promote = (pick: Player) => {
      academy = academy.filter((p) => p.id !== pick.id);
      players = [...players, { ...pick, cap: freeCap(players, pick.position) }];
      contracts[pick.id] = youthContract(pick, potential[pick.id] ?? overall(pick), year);
      squad[pick.id] = { condition: 100 };
      called.push(`${pick.name} (${pick.age}, ${pick.position})`);
    };
    const generate = (needGk: boolean) => {
      const [{ player, potential: pot }] = youthIntake({ ...team, players }, rng, year, needGk, 1);
      // Ids distinct from the summer academy intake.
      const p = { ...player, id: `${team.id}-R${year}-${players.length + 1}` };
      players = [...players, p];
      potential[p.id] = pot;
      contracts[p.id] = { wage: 3000, until: year + 2 };
      squad[p.id] = { condition: 100 };
      called.push(`${p.name} (${p.age}, ${p.position})`);
    };
    // Goalkeepers first (the manager's club takes its own academy goalkeepers), then the other places:
    // the manager's club promotes academy players, oldest first so the newest intake stays longest.
    const own = team.id === state.managedClubId;
    while (gks() < 2) {
      const keeper = own ? academy.filter((p) => p.position === 'GK').sort((a, b) => b.age - a.age)[0] : undefined;
      if (keeper) promote(keeper);
      else generate(true);
    }
    while (players.length < MIN_SQUAD) {
      const next = own ? [...academy].sort((a, b) => b.age - a.age || overall(b) - overall(a))[0] : undefined;
      if (next) promote(next);
      else generate(false);
    }
    if (team.id === state.managedClubId)
      news.push({ round: 0, kind: 'training', text: `With only ${team.players.length} players registered, the club called up ${called.length} academy player${called.length > 1 ? 's' : ''}: ${called.join(', ')}.` });
    return { ...team, players };
  });
  return { ...state, teams, contracts, potential, squad, academy, news: news.slice(-NEWS_KEPT) };
}

function upgradeSave(state: CareerState): CareerState {
  const teams = fixAges(state.teams);
  if (state.version >= CAREER_VERSION && state.squad && state.news && state.potential && state.individual && state.contracts && state.transfers && state.staff && state.matchLog && state.competitions && teams === state.teams) return state;
  const potential = state.potential ?? potentials(teams, state.seed);
  const money = state.contracts && state.finances ? { contracts: state.contracts, finances: state.finances } : moneyFor(teams, state.seed, seasonYear(state.season), potential);
  return {
    ...state,
    teams,
    ...money,
    freeAgents: state.freeAgents ?? [],
    negotiations: state.negotiations ?? {},
    bids: state.bids ?? {},
    transferList: state.transferList ?? [],
    offers: state.offers ?? [],
    transfers: state.transfers ?? [],
    scouting: state.scouting ?? {},
    matchLog: state.matchLog ?? {},
    // Before the calendar (v9) every fixture was a league round, one round per matchday.
    competitions: state.competitions ?? seasonCompetitions(state.leagueName),
    fixtures: state.fixtures.map((f) => (f.competition ? f : { ...f, competition: LEAGUE, stage: `Round ${f.round}`, matchday: f.round })),
    ...(state.staff ? { staff: state.staff, staffMarket: state.staffMarket ?? staffMarket(state.seed, state.season), finances: money.finances } : withStaff(state.seed, teams, state.managedClubId, money.finances, state.season)),
    individual: state.individual ?? {},
    trainingRatings: state.trainingRatings ?? {},
    version: CAREER_VERSION,
    potential,
    expectation: state.expectation ?? boardExpectation(state.teams, state.managedClubId),
    history: state.history ?? [],
    playerHistory: state.playerHistory ?? {},
    squad: state.squad ?? Object.fromEntries(state.teams.flatMap((t) => t.players.map((p) => [p.id, { condition: 100 }]))),
    training: state.training ?? { ...DEFAULT_TRAINING },
    morale: state.morale ?? Object.fromEntries(state.teams.map((t) => [t.id, DEFAULT_MORALE])),
    progress: state.progress ?? {},
    news: state.news ?? [],
  };
}

/** Add days to an ISO date. */
export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Double round robin (the circle method): every club plays every other club once
 * at home and once away. With an odd number of clubs, one club rests each round.
 * Rounds are a week apart, with a two-week winter break.
 */
export function makeSchedule(teamIds: string[], seed: number, startDate = seasonStart(seasonYear(SEASON)), gapDays = 7, winterBreak = true): Fixture[] {
  const rng = createRng(seed ^ 0x5eed);
  const ids: (string | null)[] = [...teamIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  if (ids.length % 2) ids.unshift(null); // the bye takes the fixed slot, so every club keeps alternating
  const n = ids.length;
  const firstHalf: [string, string][][] = [];
  const rotation = [...ids];
  for (let round = 0; round < n - 1; round++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = rotation[i];
      const b = rotation[n - 1 - i];
      if (!a || !b) continue;
      // Berger rule: the fixed club alternates every round, the others by table position,
      // so nobody plays more than two home or away matches in a row (three at the half-way turn).
      const firstAtHome = i === 0 ? round % 2 === 0 : i % 2 === 1;
      pairs.push(firstAtHome ? [a, b] : [b, a]);
    }
    firstHalf.push(pairs);
    rotation.splice(1, 0, rotation.pop()!);
  }
  const rounds = [...firstHalf, ...firstHalf.map((pairs) => pairs.map(([h, a]) => [a, h] as [string, string]))];

  const fixtures: Fixture[] = [];
  let date = startDate;
  rounds.forEach((pairs, r) => {
    // Winter break: no matches from Dec 20 to Jan 3.
    while (winterBreak && (date.slice(5) >= '12-20' || date.slice(5) <= '01-03')) date = addDays(date, 7);
    pairs.forEach(([homeId, awayId], i) => fixtures.push({ id: `R${r + 1}-${i + 1}`, competition: LEAGUE, stage: `Round ${r + 1}`, round: r + 1, matchday: 0, date, homeId, awayId }));
    date = addDays(date, gapDays);
  });
  return numberMatchdays(fixtures);
}

/** The season's competitions: the league for older saves. */
export function seasonCompetitions(leagueName: string): Competition[] {
  return [{ id: LEAGUE, name: leagueName, kind: 'league' }];
}

/** A season's competitions and starting fixtures: the league, the playoffs (opened later) and the cup. */
export function seasonFixtures(
  league: LeagueDef,
  teams: Team[],
  seed: number,
  year: number,
  startDate: string,
  countries: Record<string, string> = {},
): { competitions: Competition[]; fixtures: Fixture[] } {
  const calendar = league.calendar;
  const leagueFixtures = calendar ? makeSchedule(teams.map((t) => t.id), seed, `${year + 1}-${calendar.start}`, calendar.gapDays, false) : makeSchedule(teams.map((t) => t.id), seed, startDate);
  const leagueEnd = leagueFixtures.map((f) => f.date).sort().at(-1)!;
  const knockouts = knockoutCompetitions(league, teams, year, seed ^ year, leagueEnd, (id) => countries[id]);
  return {
    competitions: [{ id: LEAGUE, name: league.name, kind: 'league' }, ...knockouts.competitions],
    fixtures: numberMatchdays([...leagueFixtures, ...knockouts.fixtures]),
  };
}

/** Number the calendar: every date with matches is a matchday, in date order. Call after adding fixtures. */
export function numberMatchdays(fixtures: Fixture[]): Fixture[] {
  const dates = [...new Set(fixtures.map((f) => f.date))].sort();
  const index = new Map(dates.map((d, i) => [d, i + 1]));
  return fixtures.map((f) => ({ ...f, matchday: index.get(f.date)! }));
}

/** Days between two ISO dates. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------- queries

export const totalMatchdays = (state: CareerState) => Math.max(...state.fixtures.map((f) => f.matchday));

/** The first matchday with a match still to play, or undefined when the season is over. */
export function nextMatchday(state: CareerState): number | undefined {
  const open = state.fixtures.filter((f) => !f.result).map((f) => f.matchday);
  return open.length ? Math.min(...open) : undefined;
}

/** The date of a matchday. */
export const matchdayDate = (state: CareerState, matchday: number) => state.fixtures.find((f) => f.matchday === matchday)?.date;

/** Rounds in the league's regular season. */
export const leagueRounds = (state: CareerState) => Math.max(0, ...state.fixtures.filter((f) => f.competition === LEAGUE).map((f) => f.round));

export const competitionName = (state: CareerState, id: string) => state.competitions.find((c) => c.id === id)?.name ?? id;

export const seasonFinished = (state: CareerState) => nextMatchday(state) === undefined;

/** The managed club's match on a matchday (undefined when the club has no match that day). */
export function managedFixture(state: CareerState, matchday: number): Fixture | undefined {
  return state.fixtures.find((f) => f.matchday === matchday && (f.homeId === state.managedClubId || f.awayId === state.managedClubId));
}

/** A club's country: stored since national competitions; worked out for older saves. */
export function clubCountry(state: CareerState, clubId: string): string | undefined {
  return state.clubCountries?.[clubId] ?? ADRIATIC_CLUB_COUNTRIES[clubId] ?? (clubId.startsWith('GEN-vrl') ? 'SRB' : undefined);
}

/** Move transfer funds into the wage budget (or back), within what the board allows. */
export function setWageBudget(state: CareerState, amount: number): CareerState {
  const f = state.finances[state.managedClubId];
  const { min, max } = wageBudgetRange(f);
  const wageBudget = Math.round(Math.max(min, Math.min(max, amount)) / 1000) * 1000;
  return { ...state, finances: { ...state.finances, [state.managedClubId]: { ...f, boardWageBudget: f.boardWageBudget ?? f.wageBudget, wageBudget } } };
}

/** Older names, from when the season was one league round per week. */
export const nextRound = nextMatchday;
export const totalRounds = totalMatchdays;

/** A club ready for the match engine, with the manager's tactics for their own team. */
/** Any club the career knows: the league's clubs and the rest of Europe. */
export const clubById = (state: CareerState, clubId: string): Team | undefined => state.teams.find((t) => t.id === clubId) ?? state.foreign?.find((t) => t.id === clubId);
export const allClubs = (state: CareerState): Team[] => [...state.teams, ...(state.foreign ?? [])];

export function teamFor(state: CareerState, clubId: string): Team {
  const team = clubById(state, clubId);
  if (!team) throw new Error(`Unknown club ${clubId}`);
  return clubId === state.managedClubId ? { ...team, tactics: { ...state.tactics } } : team;
}

/** Every match has its own seed, derived from the career seed, so a season replays identically. */
export function fixtureSeed(state: CareerState, fixture: Fixture): number {
  let h = state.seed >>> 0;
  for (const ch of `${state.season}/${fixture.id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function leagueTable(state: CareerState): TableRow[] {
  const rows = new Map<string, TableRow>(
    state.teams.map((t) => [t.id, { clubId: t.id, played: 0, won: 0, shootoutWon: 0, shootoutLost: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [] }]),
  );
  const played = state.fixtures.filter((f) => f.result && f.competition === LEAGUE).sort((a, b) => a.round - b.round);
  for (const f of played) {
    const [h, a] = f.result!.score;
    for (const [id, gf, ga] of [[f.homeId, h, a], [f.awayId, a, h]] as const) {
      const row = rows.get(id)!;
      row.played++;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      const so = f.result!.shootout;
      const shootoutWin = gf === ga && so ? (id === f.homeId ? so[0] > so[1] : so[1] > so[0]) : undefined;
      if (gf > ga) {
        row.won++;
        row.points += POINTS.win;
      } else if (gf < ga) {
        row.lost++;
        row.points += POINTS.loss;
      } else if (shootoutWin === true) {
        row.shootoutWon++;
        row.points += POINTS.shootoutWin;
      } else if (shootoutWin === false) {
        row.shootoutLost++;
        row.points += POINTS.shootoutLoss;
      } else {
        row.drawn++;
        row.points += POINTS.draw;
      }
      const outcome: 'W' | 'D' | 'L' = gf > ga || shootoutWin === true ? 'W' : gf < ga || shootoutWin === false ? 'L' : 'D';
      row.form = [...row.form, outcome].slice(-5);
    }
  }
  const name = (id: string) => state.teams.find((t) => t.id === id)?.name ?? id;
  return [...rows.values()]
    .map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || name(a.clubId).localeCompare(name(b.clubId)));
}

/** A player's average match rating this season (undefined before his first rated match). */
export const averageRating = (s: PlayerSeason | undefined) => (s?.rated ? Math.round(((s.ratingSum ?? 0) / s.rated) * 100) / 100 : undefined);

export function topScorers(state: CareerState, limit = 10) {
  return Object.entries(state.playerStats)
    .filter(([, s]) => s.goals > 0)
    .sort((a, b) => b[1].goals - a[1].goals || a[1].apps - b[1].apps)
    .slice(0, limit)
    .map(([playerId, s]) => ({ playerId, ...s }));
}

export function findPlayer(state: CareerState, playerId: string) {
  for (const team of state.teams) {
    const player = team.players.find((p) => p.id === playerId);
    if (player) return { player, team };
  }
  return undefined;
}

// ---------------------------------------------------------------- updates

const emptySeason = (): PlayerSeason => ({ apps: 0, goals: 0, shots: 0, assists: 0, exclusionsDrawn: 0, fouls: 0, saves: 0, minutes: 0 });

/** Store a finished match in the career and add it to the players' season statistics. */
export function recordResult(input: CareerState, fixtureId: string, result: MatchResult, played: FixtureResult['played'], now = new Date().toISOString()): CareerState {
  const state = migrateCareer(input);
  const fixture = state.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);
  if (fixture.result) throw new Error(`Fixture ${fixtureId} has already been played`);
  if (result.teams[0].id !== fixture.homeId || result.teams[1].id !== fixture.awayId) throw new Error('The result is for a different match');

  const box = boxScore(result);
  const playerStats = { ...state.playerStats };
  // Goals conceded while each goalkeeper was in goal.
  const conceded: Record<string, number> = {};
  for (const e of result.events) if (e.type === 'goal' && e.situation !== 'shootout' && e.other) conceded[e.other] = (conceded[e.other] ?? 0) + 1;
  const { ratings, manOfTheMatch } = matchRatings(result);
  const scorers: FixtureResult['scorers'] = [];
  for (const [id, s] of Object.entries(box.players)) {
    if (!s.seconds) continue;
    const season = { ...(playerStats[id] ?? emptySeason()) };
    season.apps++;
    season.goals += s.goals;
    season.shots += s.shots;
    season.assists += s.assists;
    season.exclusionsDrawn += s.exclusionsDrawn;
    season.fouls += s.personalFouls;
    season.saves += s.saves;
    season.conceded = (season.conceded ?? 0) + (conceded[id] ?? 0);
    season.minutes += Math.round(s.seconds / 60);
    if (ratings[id] !== undefined) {
      season.ratingSum = (season.ratingSum ?? 0) + ratings[id];
      season.rated = (season.rated ?? 0) + 1;
    }
    if (manOfTheMatch === id) season.mom = (season.mom ?? 0) + 1;
    playerStats[id] = season;
    if (s.goals) scorers.push({ playerId: id, goals: s.goals });
  }
  // Fitness: players lose condition by minutes played.
  const squad = { ...state.squad };
  for (const [id, s] of Object.entries(box.players)) {
    if (!s.seconds) continue;
    squad[id] = { ...(squad[id] ?? { condition: 100 }), condition: conditionAfterMatch(squad[id]?.condition ?? 100, s.seconds / 60) };
  }
  const news = [...state.news];
  const managedSide = fixture.homeId === state.managedClubId ? 0 : fixture.awayId === state.managedClubId ? 1 : undefined;
  for (const { playerId, team, injury } of matchInjuries(result)) {
    squad[playerId] = { ...(squad[playerId] ?? { condition: 100 }), injury };
    if (team === managedSide) {
      const name = result.teams[team].players.find((p) => p.id === playerId)?.name ?? playerId;
      news.push({ round: fixture.matchday, kind: 'injury', text: `${name} was injured in the match (${injury.name.toLowerCase()}): out for ${injury.weeksLeft} week${injury.weeksLeft > 1 ? 's' : ''}.` });
    }
  }
  // Morale follows results.
  const [hg, ag] = result.score;
  const morale = {
    ...state.morale,
    [fixture.homeId]: moraleAfter(state.morale[fixture.homeId] ?? DEFAULT_MORALE, hg, ag),
    [fixture.awayId]: moraleAfter(state.morale[fixture.awayId] ?? DEFAULT_MORALE, ag, hg),
  };
  if (managedSide !== undefined) {
    const [mine, theirs] = managedSide === 0 ? [hg, ag] : [ag, hg];
    const opponent = clubById(state, managedSide === 0 ? fixture.awayId : fixture.homeId)?.name ?? '';
    const verb = mine > theirs ? 'Won' : mine === theirs ? 'Drew' : 'Lost';
    news.push({ round: fixture.matchday, kind: 'result', text: `${verb} ${mine}–${theirs} ${managedSide === 0 ? 'at home to' : 'away at'} ${opponent}.` });
  }

  // Match-by-match log for the manager's players.
  const matchLog = { ...state.matchLog };
  if (fixture.homeId === state.managedClubId || fixture.awayId === state.managedClubId) {
    const home = fixture.homeId === state.managedClubId;
    const side = home ? 0 : 1;
    for (const p of result.teams[side].players) {
      const s = box.players[p.id];
      if (!s?.seconds) continue;
      matchLog[p.id] = [
        ...(matchLog[p.id] ?? []),
        {
          round: fixture.round, matchday: fixture.matchday, competition: fixture.competition, stage: fixture.stage, date: fixture.date, opponentId: home ? fixture.awayId : fixture.homeId, home,
          score: home ? [result.score[0], result.score[1]] : [result.score[1], result.score[0]],
          minutes: Math.round(s.seconds / 60), goals: s.goals, shots: s.shots, assists: s.assists, exclusionsDrawn: s.exclusionsDrawn,
          fouls: s.personalFouls, saves: s.saves, conceded: conceded[p.id] ?? 0, rating: ratings[p.id], mom: manOfTheMatch === p.id,
          ...(result.shootout ? { shootout: home ? [result.shootout[0], result.shootout[1]] : [result.shootout[1], result.shootout[0]] } : {}),
        },
      ];
    }
  }

  const resultSummary: FixtureResult = {
    score: [...result.score] as [number, number],
    quarterScores: result.quarterScores.map((q) => [...q] as [number, number]),
    seed: result.seed,
    scorers: scorers.sort((a, b) => b.goals - a.goals),
    played,
    ...(result.shootout ? { shootout: [...result.shootout] as [number, number] } : {}),
    ...(manOfTheMatch ? { manOfTheMatch } : {}),
  };
  return {
    ...state,
    updatedAt: now,
    playerStats,
    matchLog,
    squad,
    morale,
    news: news.slice(-NEWS_KEPT),
    fixtures: state.fixtures.map((f) => (f.id === fixtureId ? { ...f, result: resultSummary } : f)),
  };
}

/** The 13 a club names for a match (the manager's choice for their own club, else the assistant's). */
export function matchdaySquad(state: CareerState, clubId: string): string[] {
  const team = teamFor(state, clubId);
  return pickMatchday(team, state.squad, clubId === state.managedClubId ? state.selection?.matchday : undefined);
}

/**
 * Everything the match engine needs for a career match: the matchday squads,
 * starting energy from fitness, the manager's starting seven, and morale.
 * League matches can end in a draw (no shootout).
 */
export function matchSetup(input: CareerState, fixture: Fixture): { home: Team; away: Team; options: MatchOptions } {
  const state = migrateCareer(input);
  const side = (clubId: string) => {
    const team = teamFor(state, clubId);
    const matchday = matchdaySquad(state, clubId);
    const squadTeam = { ...team, players: team.players.filter((p) => matchday.includes(p.id)) };
    const starters = clubId === state.managedClubId ? validStarters(team, matchday, state.selection?.starters) : undefined;
    return { team: squadTeam, starters };
  };
  const home = side(fixture.homeId);
  const away = side(fixture.awayId);
  const energy: Record<string, number> = {};
  for (const p of [...home.team.players, ...away.team.players]) energy[p.id] = state.squad[p.id]?.condition ?? 100;
  return {
    home: home.team,
    away: away.team,
    options: {
      seed: fixtureSeed(state, fixture),
      // No draws: league games and knockout games level after regular time go to penalties.
      // The first leg of a two-legged European tie can end level (penalties come after the second leg, on aggregate).
      shootoutOnDraw: !fixture.leg,
      initialEnergy: energy,
      lineups: [home.starters, away.starters],
      formBonus: [
        moraleBonus(state.morale[fixture.homeId] ?? DEFAULT_MORALE) + (fixture.homeId === state.managedClubId ? assistantFormBonus(state.staff) : 0),
        moraleBonus(state.morale[fixture.awayId] ?? DEFAULT_MORALE) + (fixture.awayId === state.managedClubId ? assistantFormBonus(state.staff) : 0),
      ],
    },
  };
}

/** Simulate one match of the career. */
export function simulateFixture(state: CareerState, fixture: Fixture): MatchResult {
  const { home, away, options } = matchSetup(state, fixture);
  return simulateMatch(home, away, options);
}

/**
 * Play a matchday: simulate every unplayed match on it (the manager's own match included,
 * unless already recorded), then the days until the next matchday pass: healing, recovery
 * and training, scaled by how many days there are.
 */
export function simulateMatchday(input: CareerState, matchday: number, now?: string): CareerState {
  const state = migrateCareer(input);
  let next = state;
  const open = state.fixtures.filter((x) => x.matchday === matchday && !x.result);
  for (const f of open) next = recordResult(next, f.id, simulateFixture(next, f), 'simulated', now);
  if (!open.length && state.fixtures.some((f) => f.matchday === matchday)) return next; // already played
  // Brackets move on: next games of series, next rounds, the playoffs once the league is over.
  next = advanceCompetitions(next);
  const date = matchdayDate(next, matchday);
  const following = matchdayDate(next, matchday + 1);
  const days = date && following ? daysBetween(date, following) : 7;
  const clubMatches = next.fixtures.filter((f) => f.result && (f.homeId === next.managedClubId || f.awayId === next.managedClubId)).length;
  const week = trainingWeek({
    round: matchday,
    days,
    seed: state.seed,
    teams: next.teams,
    squad: next.squad,
    progress: next.progress,
    managedClubId: next.managedClubId,
    training: next.training,
    individual: next.individual,
    morale: next.morale[next.managedClubId],
    ratings: next.trainingRatings,
    minutes: Object.fromEntries(Object.entries(next.playerStats).map(([id, s]) => [id, s.minutes])),
    roundsPlayed: clubMatches,
    staff: next.staff,
  });
  // Wages out, income in.
  // Clubs from abroad are always fit for their next European game (they train and rest elsewhere).
  if (next.foreign?.length) {
    const abroad = new Set(next.foreign.flatMap((t) => t.players.map((p) => p.id)));
    week.squad = Object.fromEntries(Object.entries(week.squad).filter(([id]) => !abroad.has(id)));
  }
  // The academy trains too.
  const youth = academyWeek({ ...next, teams: week.teams }, days, createRng((state.seed ^ Math.imul(matchday + 7, 0x2f6b)) >>> 0));
  next = { ...next, ...youth };
  // Wages out and income in on league matchdays (a share of the yearly figures per league round).
  const leagueDay = next.fixtures.some((f) => f.matchday === matchday && f.competition === LEAGUE);
  const rounds = leagueRounds(next);
  const finances = Object.fromEntries(
    week.teams.map((t) => [
      t.id,
      next.finances[t.id] && leagueDay ? roundFinances(next.finances[t.id], t, next.contracts, matchday, rounds, t.id === next.managedClubId, t.id === next.managedClubId ? staffWages(next.staff) : 0) : next.finances[t.id],
    ]),
  );
  return {
    ...next,
    finances,
    teams: week.teams,
    squad: week.squad,
    progress: week.progress,
    trainingReport: week.report,
    trainingRatings: week.ratings,
    news: [...next.news, ...week.news].slice(-NEWS_KEPT),
  };
}

/** Older name, from when every matchday was a league round. */
export const simulateRound = simulateMatchday;

// ---------------------------------------------------------------- contracts

/** Players of the managed club whose contracts end this season. */
export function expiringContracts(state: CareerState): Player[] {
  const year = seasonYear(state.season);
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  return club.players.filter((p) => (state.contracts[p.id]?.until ?? year) <= year);
}

/** What a player of the managed club wants for a new contract. */
export function contractDemand(state: CareerState, playerId: string): RenewalDemand {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const p = club.players.find((x) => x.id === playerId);
  if (!p) throw new Error('Not one of your players');
  const played = state.playerStats[playerId]?.minutes ?? 0;
  const rounds = state.fixtures.filter((f) => f.result && (f.homeId === club.id || f.awayId === club.id)).length;
  const share = rounds ? played / (rounds * 32) : 0.5;
  return renewalDemand(p, state.potential[playerId] ?? overall(p), state.seed, share);
}

/** Room under the wage budget if this player's current wage were replaced. */
export function wageRoom(state: CareerState, playerId?: string): number {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const f = state.finances[club.id];
  return f.wageBudget - wageBill(club, state.contracts) - staffWages(state.staff ?? {}) + (playerId ? (state.contracts[playerId]?.wage ?? 0) : 0);
}

export interface OfferOutcome {
  accepted: boolean;
  message: string;
  state: CareerState;
}

/**
 * Offer a player of the managed club a new contract. The board refuses deals over
 * the wage budget; the player may accept, refuse, or end the talks if insulted.
 * At most three offers per player per season.
 */
export function offerContract(state: CareerState, playerId: string, wage: number, years: number): OfferOutcome {
  const talks = state.negotiations[playerId] ?? { attempts: 0 };
  if (talks.closed) return { accepted: false, message: 'He is not willing to talk any more this season.', state };
  if (talks.attempts >= 3) return { accepted: false, message: 'Talks have broken down: try again next season.', state };
  if (years < 1 || years > 5) return { accepted: false, message: 'Contracts run 1 to 5 seasons.', state };
  if (wage > wageRoom(state, playerId)) return { accepted: false, message: 'The board will not approve it: this would break the wage budget.', state };
  const demand = contractDemand(state, playerId);
  let h = (state.seed ^ (talks.attempts + 1) * 7919) >>> 0;
  for (const ch of `${state.season}/${playerId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const answer = respondToOffer(demand, wage, years, createRng(h));
  const insulted = !answer.accepted && wage / demand.wage < 0.85;
  const negotiations = { ...state.negotiations, [playerId]: { attempts: talks.attempts + 1, closed: answer.accepted || insulted } };
  if (!answer.accepted) return { accepted: false, message: answer.message, state: { ...state, negotiations } };
  const year = seasonYear(state.season);
  const contracts = { ...state.contracts, [playerId]: { wage, until: Math.max(year, (state.contracts[playerId]?.until ?? year)) + years } };
  const name = state.teams.flatMap((t) => t.players).find((p) => p.id === playerId)?.name ?? playerId;
  const news = [...state.news, { round: nextRound(state) ?? 0, kind: 'result' as const, text: `${name} signs a new ${years}-season contract.` }].slice(-NEWS_KEPT);
  return { accepted: true, message: answer.message, state: { ...state, contracts, negotiations, news } };
}

// ---------------------------------------------------------------- staff

/** Hire a coach, physio or scout from the staff market, replacing whoever holds the role (paid off: half a season's wage). */
export function hireStaff(state: CareerState, candidateId: string): { message: string; state: CareerState } {
  const candidate = state.staffMarket.find((m) => m.id === candidateId);
  if (!candidate) return { message: 'That candidate is no longer available.', state };
  const current = state.staff[candidate.role];
  const payoff = current ? Math.round(current.wage * 0.5) : 0;
  const room = wageRoom(state) + (current?.wage ?? 0);
  if (candidate.wage > room) return { message: 'The board will not approve it: the wage budget is full.', state };
  const f = state.finances[state.managedClubId];
  if (payoff > f.balance) return { message: `Not enough money to pay off ${current!.name}.`, state };
  const round = nextRound(state) ?? 0;
  const finances = {
    ...state.finances,
    [state.managedClubId]: { ...f, balance: f.balance - payoff, ledger: payoff ? [...f.ledger, { round, label: `Paid off ${current!.name}`, amount: -payoff }] : f.ledger },
  };
  return {
    message: `${candidate.name} joins as ${candidate.role === 'scout' ? 'chief scout' : candidate.role === 'physio' ? 'physio' : `${candidate.role} coach`}.`,
    state: {
      ...state,
      finances,
      staff: { ...state.staff, [candidate.role]: candidate },
      staffMarket: state.staffMarket.filter((m) => m.id !== candidateId),
      news: [...state.news, { round, kind: 'result' as const, text: `Staff: ${candidate.name} hired${current ? `, replacing ${current.name}` : ''}.` }].slice(-NEWS_KEPT),
    },
  };
}

/** Let a member of staff go: half a season's wage is paid off. */
export function fireStaff(state: CareerState, role: StaffRole): { message: string; state: CareerState } {
  const current = state.staff[role];
  if (!current) return { message: 'Nobody holds that role.', state };
  const payoff = Math.round(current.wage * 0.5);
  const f = state.finances[state.managedClubId];
  const staff = { ...state.staff };
  delete staff[role];
  const round = nextRound(state) ?? 0;
  return {
    message: `${current.name} has left the club.`,
    state: {
      ...state,
      staff,
      finances: { ...state.finances, [state.managedClubId]: { ...f, balance: f.balance - payoff, ledger: [...f.ledger, { round, label: `Paid off ${current.name}`, amount: -payoff }] } },
    },
  };
}

/** Give a player of the managed club his own training focus ('team' = follow the team plan). */
export function setIndividualFocus(state: CareerState, playerId: string, focus: IndividualFocus): CareerState {
  const individual = { ...state.individual };
  if (focus === 'team') delete individual[playerId];
  else individual[playerId] = focus;
  return { ...state, individual };
}

export function setTraining(state: CareerState, training: Training): CareerState {
  return { ...state, training: { ...training } };
}

export function setSelection(state: CareerState, selection: Selection | undefined): CareerState {
  return { ...state, selection: selection && { matchday: [...selection.matchday], starters: [...selection.starters] } };
}

export function setTactics(state: CareerState, tactics: Tactics): CareerState {
  return { ...state, tactics: { ...tactics } };
}
