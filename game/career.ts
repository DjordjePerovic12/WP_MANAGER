// Career mode: one league season for a club the user manages.
//
// Pure functions over a plain CareerState object (easy to save as JSON):
// create a career, find the next round, record or simulate matches, and read
// the league table and statistics. Functions never mutate their input.

import { boxScore } from '../engine/stats';
import { createRng } from '../engine/rng';
import { DEFAULT_TACTICS, generateTeam } from '../engine/generate';
import { simulateMatch } from '../engine/match';
import type { Attributes, MatchOptions, MatchResult, Player, Tactics, Team } from '../engine/types';
import { overall } from '../engine/ratings';
import type { LeagueDef } from './leagues';
import { boardExpectation, initialPotential, START_SQUAD } from './development';
import type { SeasonRecord, PlayerSeasonEntry, SummerReport } from './seasons';
import type { Bid, IncomingOffer, TransferRecord } from './transfers';
import { trainingWeek, type IndividualFocus, type TrainingReport } from './training';
import {
  expectedWage,
  initialContracts,
  initialFinances,
  renewalDemand,
  respondToOffer,
  roundFinances,
  wageBill,
  type ClubFinances,
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

export const CAREER_VERSION = 6;
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
const POINTS = { win: 3, draw: 1, loss: 0 };

export interface FixtureResult {
  score: [number, number];
  quarterScores: [number, number][];
  seed: number;
  /** goals per player in this match */
  scorers: { playerId: string; goals: number }[];
  played: 'live' | 'simulated';
}

export interface Fixture {
  id: string;
  round: number;
  date: string; // ISO yyyy-mm-dd
  homeId: string;
  awayId: string;
  result?: FixtureResult;
}

export interface PlayerSeason {
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
}

function potentials(teams: Team[], seed: number): Record<string, number> {
  const rng = createRng((seed ^ 0x9071) >>> 0);
  return Object.fromEntries(teams.flatMap((t) => t.players.map((p) => [p.id, initialPotential(p, rng)])));
}

export interface TableRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** last five results, most recent last */
  form: ('W' | 'D' | 'L')[];
}

// ---------------------------------------------------------------- creation

/**
 * Start a career. `realTeams` are the league's real clubs; generated clubs are
 * added until the league reaches its size.
 */
export function createCareer(options: { league: LeagueDef; realTeams: Team[]; managedClubId: string; seed?: number; id?: string; now?: string }): CareerState {
  const { league, realTeams, managedClubId } = options;
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = createRng(seed);
  if (!realTeams.some((t) => t.id === managedClubId)) throw new Error(`Club ${managedClubId} is not in ${league.name}`);

  const missing = Math.max(0, league.size - realTeams.length);
  const generatedTeams = league.fillerNames.slice(0, missing).map(([name, short], i) => {
    const [lo, hi] = league.fillerQuality;
    const quality = hi - ((hi - lo) * i) / Math.max(1, missing - 1);
    return generateTeam(rng, `GEN-${league.id}-${short}`, name, short, quality);
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
  return {
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
    fixtures: makeSchedule(teams.map((t) => t.id), seed),
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
  };
}

function moneyFor(teams: Team[], seed: number, year: number, potential: Record<string, number>) {
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
  const teams = fixAges(state.teams);
  if (state.version >= CAREER_VERSION && state.squad && state.news && state.potential && state.individual && state.contracts && state.transfers && teams === state.teams) return state;
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
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Double round robin (the circle method): every club plays every other club once
 * at home and once away. With an odd number of clubs, one club rests each round.
 * Rounds are a week apart, with a two-week winter break.
 */
export function makeSchedule(teamIds: string[], seed: number, startDate = seasonStart(seasonYear(SEASON))): Fixture[] {
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
    while (date.slice(5) >= '12-20' || date.slice(5) <= '01-03') date = addDays(date, 7);
    pairs.forEach(([homeId, awayId], i) => fixtures.push({ id: `R${r + 1}-${i + 1}`, round: r + 1, date, homeId, awayId }));
    date = addDays(date, 7);
  });
  return fixtures;
}

// ---------------------------------------------------------------- queries

export const totalRounds = (state: CareerState) => Math.max(...state.fixtures.map((f) => f.round));

/** The first round with a match still to play, or undefined when the season is over. */
export function nextRound(state: CareerState): number | undefined {
  const open = state.fixtures.filter((f) => !f.result).map((f) => f.round);
  return open.length ? Math.min(...open) : undefined;
}

export const seasonFinished = (state: CareerState) => nextRound(state) === undefined;

/** The managed club's match in a round (undefined when the club rests that week). */
export function managedFixture(state: CareerState, round: number): Fixture | undefined {
  return state.fixtures.find((f) => f.round === round && (f.homeId === state.managedClubId || f.awayId === state.managedClubId));
}

/** A club ready for the match engine, with the manager's tactics for their own team. */
export function teamFor(state: CareerState, clubId: string): Team {
  const team = state.teams.find((t) => t.id === clubId);
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
    state.teams.map((t) => [t.id, { clubId: t.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [] }]),
  );
  const played = state.fixtures.filter((f) => f.result).sort((a, b) => a.round - b.round);
  for (const f of played) {
    const [h, a] = f.result!.score;
    for (const [id, gf, ga] of [[f.homeId, h, a], [f.awayId, a, h]] as const) {
      const row = rows.get(id)!;
      row.played++;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      const outcome: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      if (outcome === 'W') row.won++;
      else if (outcome === 'D') row.drawn++;
      else row.lost++;
      row.points += outcome === 'W' ? POINTS.win : outcome === 'D' ? POINTS.draw : POINTS.loss;
      row.form = [...row.form, outcome].slice(-5);
    }
  }
  const name = (id: string) => state.teams.find((t) => t.id === id)?.name ?? id;
  return [...rows.values()]
    .map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || name(a.clubId).localeCompare(name(b.clubId)));
}

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
    season.minutes += Math.round(s.seconds / 60);
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
      news.push({ round: fixture.round, kind: 'injury', text: `${name} was injured in the match (${injury.name.toLowerCase()}): out for ${injury.weeksLeft} week${injury.weeksLeft > 1 ? 's' : ''}.` });
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
    const opponent = state.teams.find((t) => t.id === (managedSide === 0 ? fixture.awayId : fixture.homeId))!.name;
    const verb = mine > theirs ? 'Won' : mine === theirs ? 'Drew' : 'Lost';
    news.push({ round: fixture.round, kind: 'result', text: `${verb} ${mine}–${theirs} ${managedSide === 0 ? 'at home to' : 'away at'} ${opponent}.` });
  }

  const resultSummary: FixtureResult = {
    score: [...result.score] as [number, number],
    quarterScores: result.quarterScores.map((q) => [...q] as [number, number]),
    seed: result.seed,
    scorers: scorers.sort((a, b) => b.goals - a.goals),
    played,
  };
  return {
    ...state,
    updatedAt: now,
    playerStats,
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
      shootoutOnDraw: false,
      initialEnergy: energy,
      lineups: [home.starters, away.starters],
      formBonus: [moraleBonus(state.morale[fixture.homeId] ?? DEFAULT_MORALE), moraleBonus(state.morale[fixture.awayId] ?? DEFAULT_MORALE)],
    },
  };
}

/** Simulate one match of the career. */
export function simulateFixture(state: CareerState, fixture: Fixture): MatchResult {
  const { home, away, options } = matchSetup(state, fixture);
  return simulateMatch(home, away, options);
}

/** Simulate every unplayed match of a round (the manager's own match included, unless already recorded). */
export function simulateRound(input: CareerState, round: number, now?: string): CareerState {
  const state = migrateCareer(input);
  let next = state;
  const open = state.fixtures.filter((x) => x.round === round && !x.result);
  for (const f of open) next = recordResult(next, f.id, simulateFixture(next, f), 'simulated', now);
  if (!open.length && state.fixtures.some((f) => f.round === round)) return next; // round already done
  // The week until the next round: healing, recovery and training.
  const week = trainingWeek({
    round,
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
    roundsPlayed: round,
  });
  // Wages out, income in.
  const rounds = totalRounds(next);
  const finances = Object.fromEntries(
    week.teams.map((t) => [t.id, next.finances[t.id] ? roundFinances(next.finances[t.id], t, next.contracts, round, rounds, t.id === next.managedClubId) : next.finances[t.id]]),
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
  return f.wageBudget - wageBill(club, state.contracts) + (playerId ? (state.contracts[playerId]?.wage ?? 0) : 0);
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
