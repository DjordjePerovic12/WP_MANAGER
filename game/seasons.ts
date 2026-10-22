// The end of a season and the summer that follows: review and awards, history,
// aging and development, retirements, youth academy, and the new season's fixtures.

import { createRng } from '../engine/rng';
import { overall, teamRating } from '../engine/ratings';
import type { Player, Team } from '../engine/types';
import { DEFAULT_TACTICS } from '../engine/generate';
import type { Rng } from '../engine/rng';
import {
  allClubs,
  averageRating,
  clubById,
  clubCountry,
  ensureSquads,
  numberMatchdays,
  leagueTable,
  moneyFor,
  potentials,
  seasonFixtures,
  seasonFinished,
  seasonLabel,
  seasonStart,
  seasonYear,
  leagueRounds,
  type CareerState,
  type PlayerSeason,
} from './career';
import { boardExpectation, boardVerdict, developPlayer, intakeSize, MAX_SQUAD, MIN_SQUAD, retirementChance, youthIntake } from './development';
import { DEFAULT_MORALE, type NewsItem } from './squad';
import { aiRenews, expectedWage, newContract, nextBudget, prizeMoney, wageBill, type Contract, type FreeAgent, type SeasonFinance } from './finance';

import { aiTransferWindow, summerInterest, windowKey } from './transfers';
import { staffMarket } from './staff';
import { finalStandings, knockoutResult, takesPart, trophiesWon } from './competitions';
import { academySummer } from './academy';
import { boardWelcome, inboxWeek } from './inbox';
import { allocateEntries, buildEurope, europeanResult } from './europe';
import { resolveClashes } from './competitions';
import { ADRIATIC_CLUB_COUNTRIES, generatedClub, isRealClub, leagueDef, type LeagueDef } from './leagues';

const FREE_AGENTS_KEPT = 80;

export interface Award {
  kind: 'top-scorer' | 'player-of-season' | 'young-player' | 'goalkeeper';
  title: string;
  playerId: string;
  name: string;
  clubId: string;
  clubName: string;
  detail: string;
}

export interface SeasonRecord {
  season: string;
  leagueName: string;
  clubId: string;
  /** final position: after the playoffs (the league position for seasons without them) */
  position: number;
  /** position in the regular-season table */
  leaguePosition?: number;
  /** how the playoffs and the cup went, e.g. "Winners", "Out in the semi-final" */
  playoffs?: string;
  cup?: string;
  cupName?: string;
  /** the European competition and how far the club went, e.g. "Euro Cup: Quarter-final" */
  europe?: string;
  /** national championship in a multi-country league (the VRL) */
  national?: string;
  nationalName?: string;
  /** competitions won by the managed club */
  trophies?: string[];
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  championId: string;
  championName: string;
  cupWinnerName?: string;
  expectation: number;
  verdict: string;
  awards: Award[];
  table: { clubId: string; name: string; points: number; goalDifference: number }[];
}

export interface PlayerSeasonEntry {
  season: string;
  clubId: string;
  clubName: string;
  apps: number;
  goals: number;
  assists: number;
  saves: number;
  minutes: number;
  /** recorded from 2026-10 on (older saves may lack them) */
  shots?: number;
  exclusionsDrawn?: number;
  fouls?: number;
  conceded?: number;
  /** average match rating and man of the match awards (from 2026-10-22) */
  rating?: number;
  mom?: number;
}

export interface SummerChange {
  playerId: string;
  name: string;
  age: number;
  before: number;
  after: number;
}

export interface SummerReport {
  fromSeason: string;
  toSeason: string;
  retired: { name: string; age: number; clubId: string }[];
  academy: { playerId: string; name: string; position: string; age: number; potential: number }[];
  released: { name: string; age: number }[];
  improved: SummerChange[];
  declined: SummerChange[];
  /** players whose contracts ran out and who left (managed club) */
  contractsEnded: { name: string; age: number }[];
  /** last season's money (managed club) */
  finance?: SeasonFinance;
}

/** A simple season score for awards: goals, assists, exclusions drawn and saves, minus fouls. */
function seasonScore(s: PlayerSeason) {
  return s.goals + 0.7 * s.assists + 0.4 * s.exclusionsDrawn + 0.15 * s.saves - 0.25 * s.fouls;
}

export function seasonAwards(state: CareerState): Award[] {
  const rounds = leagueRounds(state);
  const entries = Object.entries(state.playerStats).map(([playerId, s]) => {
    const team = state.teams.find((t) => t.players.some((p) => p.id === playerId));
    const player = team?.players.find((p) => p.id === playerId);
    return { playerId, s, team, player };
  }).filter((e): e is { playerId: string; s: PlayerSeason; team: Team; player: Player } => !!e.team && !!e.player);
  const regular = entries.filter((e) => e.s.apps >= rounds * 0.4);
  const award = (kind: Award['kind'], title: string, pick: (typeof entries)[number] | undefined, detail: (e: (typeof entries)[number]) => string): Award[] =>
    pick ? [{ kind, title, playerId: pick.playerId, name: pick.player.name, clubId: pick.team.id, clubName: pick.team.name, detail: detail(pick) }] : [];
  const best = <T,>(xs: T[], score: (x: T) => number) => xs.reduce<T | undefined>((a, x) => (a === undefined || score(x) > score(a) ? x : a), undefined);

  return [
    ...award('top-scorer', 'Top scorer', best(entries, (e) => e.s.goals * 100 - e.s.apps), (e) => `${e.s.goals} goals in ${e.s.apps} games`),
    ...award('player-of-season', 'Player of the season', best(regular.filter((e) => e.player.position !== 'GK'), (e) => seasonScore(e.s)), (e) => `${e.s.goals} goals, ${e.s.assists} assists`),
    ...award('young-player', 'Young player of the season', best(regular.filter((e) => e.player.age <= 21 && e.player.position !== 'GK'), (e) => seasonScore(e.s)), (e) => `${e.player.age} years old · ${e.s.goals} goals`),
    ...award('goalkeeper', 'Goalkeeper of the season', best(regular.filter((e) => e.player.position === 'GK'), (e) => e.s.saves / Math.max(1, e.s.apps)), (e) => `${e.s.saves} saves in ${e.s.apps} games`),
  ];
}

/**
 * Each country's clubs in finishing order, for European places. The manager's league countries use
 * the season's results (the national championship in the VRL, else the final standings); other
 * countries, which the game doesn't play out, are ranked by squad strength with some luck.
 */
function europeanOrders(finished: CareerState, next: CareerState, rng: Rng): Record<string, string[]> {
  const byCountry: Record<string, string[]> = {};
  for (const t of allClubs(next)) {
    const c = next.clubCountries?.[t.id];
    if (c) (byCountry[c] ??= []).push(t.id);
  }
  const strength = new Map(allClubs(next).map((t) => [t.id, teamRating(t.players) + rng.range(-0.8, 0.8)]));
  const inLeague = new Set(finished.teams.map((t) => t.id));
  const orders: Record<string, string[]> = {};
  for (const [country, ids] of Object.entries(byCountry)) {
    const leagueClubs = ids.filter((id) => inLeague.has(id));
    const results = leagueClubs.length
      ? finished.competitions.some((c) => c.id === `playoffs-${country}`)
        ? finalStandings(finished, `playoffs-${country}`, leagueClubs)
        : finalStandings(finished).filter((id) => leagueClubs.includes(id))
      : [];
    const rest = ids.filter((id) => !results.includes(id)).sort((a, b) => strength.get(b)! - strength.get(a)!);
    orders[country] = [...results.filter((id) => ids.includes(id)), ...rest];
  }
  return orders;
}

/** Clubs abroad over the summer: a year older and developed, veterans retire, youngsters fill the squad. */
function ageForeign(teams: Team[], potential: Record<string, number>, rng: Rng, year: number): Team[] {
  return teams.map((team) => {
    let players = team.players
      .map((p) => developPlayer({ ...p, age: p.age + 1 }, potential[p.id] ?? overall(p), rng))
      .filter((p) => !(p.age >= 36 || (p.age >= 33 && rng.chance(0.25 * (p.age - 32)))));
    const keepers = players.filter((p) => p.position === 'GK').length;
    const needed = Math.max(0, 14 - players.length, keepers < 2 ? 1 : 0);
    if (needed) {
      const intake = youthIntake({ ...team, players }, rng, year, keepers < 2, needed);
      for (const { player, potential: pot } of intake) potential[player.id] = pot;
      players = [...players, ...intake.map((i) => i.player)];
    }
    return { ...team, players };
  });
}

/** The finished season as a history record. */
export function seasonRecord(state: CareerState): SeasonRecord {
  const table = leagueTable(state);
  const standings = finalStandings(state);
  const mine = table.find((r) => r.clubId === state.managedClubId)!;
  const position = standings.indexOf(state.managedClubId) + 1;
  const name = (id: string) => state.teams.find((t) => t.id === id)?.name ?? id;
  const cup = state.competitions.find((c) => c.kind === 'cup' && takesPart(c, state.managedClubId));
  const national = state.competitions.find((c) => c.kind === 'playoff' && c.id !== 'playoffs' && takesPart(c, state.managedClubId));
  const hasPlayoffs = state.competitions.some((c) => c.id === 'playoffs' && c.series?.length);
  const trophies = trophiesWon(state);
  if (!hasPlayoffs && standings[0] === state.managedClubId) trophies.unshift(state.leagueName);
  return {
    season: state.season,
    leagueName: state.leagueName,
    clubId: state.managedClubId,
    position,
    leaguePosition: table.indexOf(mine) + 1,
    playoffs: hasPlayoffs ? knockoutResult(state, 'playoffs', state.managedClubId) : undefined,
    cup: cup ? (knockoutResult(state, cup.id, state.managedClubId) ?? 'Did not enter') : undefined,
    cupName: cup?.name,
    national: national ? (knockoutResult(state, national.id, state.managedClubId) ?? 'Did not qualify') : undefined,
    nationalName: national?.name,
    trophies: [...trophies, ...(europeanResult(state, state.managedClubId)?.result === 'Winners' ? [europeanResult(state, state.managedClubId)!.name] : [])],
    europe: europeanResult(state, state.managedClubId) ? `${europeanResult(state, state.managedClubId)!.name}: ${europeanResult(state, state.managedClubId)!.result}` : undefined,
    points: mine.points,
    played: mine.played,
    won: mine.won + (mine.shootoutWon ?? 0),
    drawn: mine.drawn,
    lost: mine.lost + (mine.shootoutLost ?? 0),
    goalsFor: mine.goalsFor,
    goalsAgainst: mine.goalsAgainst,
    championId: standings[0],
    championName: name(standings[0]),
    cupWinnerName: cup?.championId ? name(cup.championId) : undefined,
    expectation: state.expectation,
    verdict: boardVerdict(position, state.expectation).label,
    awards: seasonAwards(state),
    table: table.map((r) => ({ clubId: r.clubId, name: name(r.clubId), points: r.points, goalDifference: r.goalDifference })),
  };
}

/**
 * The Regional (Adriatic) League was suspended in 2025-26. A career that started in it moves
 * to the real league of its club's country: the VRL (Serbia and Montenegro) or the Croatian
 * league. Clubs from elsewhere leave; generated clubs with real names fill the gaps.
 */
function moveFromAdriatic(managedClubId: string, teams: Team[], rng: Rng): { league: LeagueDef; teams: Team[]; added: Team[]; removed: Team[] } {
  const country = ADRIATIC_CLUB_COUNTRIES[managedClubId];
  const league = leagueDef(country === 'CRO' ? 'cro' : 'vrl');
  const kept = teams.filter((t) => t.id === managedClubId || league.countries.includes(ADRIATIC_CLUB_COUNTRIES[t.id] ?? ''));
  const missing = Math.max(0, league.size - kept.length);
  const fillers = league.fillerNames.filter((f) => !isRealClub(f, kept)).slice(0, missing);
  const [lo, hi] = league.fillerQuality;
  const added = fillers.map(([clubName, short], i) => {
    const quality = hi - ((hi - lo) * i) / Math.max(1, fillers.length - 1);
    const t = generatedClub(rng, `GEN-${league.id}-${short}`, clubName, short, quality);
    return { ...t, tactics: { ...DEFAULT_TACTICS, ...t.tactics } };
  });
  return { league, teams: [...kept, ...added], added, removed: teams.filter((t) => !kept.includes(t)) };
}

/**
 * Close the season and play out the summer: archive history, age and develop
 * every player, retire veterans, bring in academy players, and draw up the new
 * season's fixtures.
 */
export function startNextSeason(state: CareerState, now = new Date().toISOString()): CareerState {
  if (!seasonFinished(state)) throw new Error('The season is not over yet');
  const record = seasonRecord(state);
  const year = seasonYear(state.season) + 1;
  const rng = createRng((state.seed ^ Math.imul(year, 0x2c1b3c6d)) >>> 0);

  // Each player's season goes into his career history.
  const playerHistory = { ...state.playerHistory };
  for (const team of state.teams) {
    for (const p of team.players) {
      const s = state.playerStats[p.id];
      if (!s?.apps) continue;
      playerHistory[p.id] = [
        ...(playerHistory[p.id] ?? []),
        {
          season: state.season, clubId: team.id, clubName: team.name, apps: s.apps, goals: s.goals, assists: s.assists, saves: s.saves, minutes: s.minutes,
          shots: s.shots, exclusionsDrawn: s.exclusionsDrawn, fouls: s.fouls, conceded: s.conceded ?? 0, rating: averageRating(s), mom: s.mom ?? 0,
        },
      ];
    }
  }

  const potential = { ...state.potential };
  const report: SummerReport = { fromSeason: state.season, toSeason: seasonLabel(year), retired: [], academy: [], released: [], improved: [], declined: [], contractsEnded: [] };
  const changes: SummerChange[] = [];
  const lastYear = year - 1;
  const contracts: Record<string, Contract> = { ...state.contracts };
  // Free agents get a year older too; the oldest give up.
  let freeAgents: FreeAgent[] = (state.freeAgents ?? [])
    .map((f) => ({ ...f, player: developPlayer({ ...f.player, age: f.player.age + 1 }, f.potential, rng) }))
    .filter((f) => f.player.age <= 35);
  const toFreeAgent = (p: Player, fromClubId: string) => {
    freeAgents.push({ player: p, potential: potential[p.id] ?? overall(p), fromClubId, askingWage: expectedWage(p, potential[p.id]) });
    delete contracts[p.id];
  };

  const teams = state.teams.map((team) => {
    const level = teamRating(team.players);
    const managed = team.id === state.managedClubId;
    // A year older, a year of development.
    let players = team.players.map((p) => {
      const aged = { ...p, age: p.age + 1 };
      const developed = developPlayer(aged, potential[p.id] ?? overall(aged), rng);
      if (managed) changes.push({ playerId: p.id, name: p.name, age: aged.age, before: overall(p), after: overall(developed) });
      return developed;
    });
    // Contracts that end this summer: AI clubs keep the players they need if the wage budget allows;
    // the manager's unrenewed players leave.
    const budget = state.finances[team.id]?.wageBudget ?? Infinity;
    const staying = players.filter((p) => (contracts[p.id]?.until ?? year) > lastYear);
    let bill = staying.reduce((sum, p) => sum + (contracts[p.id]?.wage ?? 0), 0);
    const expiring = players.filter((p) => !staying.includes(p)).sort((a, b) => overall(b) - overall(a));
    const renewed = new Set<string>();
    for (const p of expiring) {
      if (managed || !aiRenews(p, team, rng)) continue;
      const offer = newContract(p, potential[p.id], year, rng);
      if (bill + offer.wage > budget) continue;
      contracts[p.id] = { ...offer, until: Math.max(offer.until, year) };
      bill += offer.wage;
      renewed.add(p.id);
    }
    players = players.filter((p) => {
      if ((contracts[p.id]?.until ?? year) > lastYear || renewed.has(p.id)) return true;
      if (managed) report.contractsEnded.push({ name: p.name, age: p.age });
      toFreeAgent(p, team.id);
      return false;
    });
    // Retirements (never below a playable squad).
    players = players.filter((p) => {
      const retire = rng.chance(retirementChance(p, level)) && players.length > MIN_SQUAD - 2;
      if (retire) {
        report.retired.push({ name: p.name, age: p.age, clubId: team.id });
        delete potential[p.id];
        delete contracts[p.id];
      }
      return !retire;
    });
    // Youth academy: two or three youngsters, more if the squad is thin, a goalkeeper if needed.
    const keepers = players.filter((p) => p.position === 'GK').length;
    // The manager's club brings youngsters into its own academy instead (below).
    const count = managed ? 0 : Math.max(intakeSize(players.length, rng), keepers < 2 ? 1 : 0);
    const intake = youthIntake({ ...team, players }, rng, year, keepers < 2, count);
    for (const { player, potential: pot } of intake) {
      potential[player.id] = pot;
      // Academy players sign a small three-season deal.
      contracts[player.id] = { wage: Math.max(3000, Math.round((expectedWage(player, pot) * 0.7) / 1000) * 1000), until: year + 2 };
      if (managed) report.academy.push({ playerId: player.id, name: player.name, position: player.position, age: player.age, potential: pot });
    }
    players = [...players, ...intake.map((i) => i.player)];
    // Squad limit: let the least promising players go.
    while (players.length > MAX_SQUAD) {
      const value = (p: Player) => overall(p) + Math.max(0, (potential[p.id] ?? 0) - overall(p)) * 0.6 - (p.age > 30 ? (p.age - 30) * 0.3 : 0);
      const keepersLeft = players.filter((p) => p.position === 'GK').length;
      const candidates = players.filter((p) => p.position !== 'GK' || keepersLeft > 2);
      const worst = candidates.reduce((a, b) => (value(b) < value(a) ? b : a));
      if (managed) report.released.push({ name: worst.name, age: worst.age });
      toFreeAgent(worst, team.id);
      delete potential[worst.id];
      players = players.filter((p) => p !== worst);
    }
    return { ...team, players: players.sort((a, b) => a.cap - b.cap) };
  });

  // Money: prize money, the season's books, and the board's budget for next season.
  const standings = finalStandings(state);
  const finances = { ...state.finances };
  for (const team of teams) {
    const f = finances[team.id];
    if (!f) continue;
    const position = standings.indexOf(team.id) + 1;
    const prize = prizeMoney(f.revenue, position, standings.length);
    const income = f.ledger.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const wages = -f.ledger.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0);
    const expected = team.id === state.managedClubId ? state.expectation : boardExpectation(state.teams, team.id);
    const after = { ...f, balance: f.balance + prize };
    const budget = nextBudget(after, position, expected, wageBill(team, contracts));
    const lastSeason: SeasonFinance = { season: state.season, income, wages, prizeMoney: prize, balanceChange: income - wages + prize };
    // A new season: the board's budget again (any extra the manager added was for last season).
    finances[team.id] = { ...after, ...budget, boardWageBudget: budget.wageBudget, ledger: [], lastSeason };
    if (team.id === state.managedClubId) report.finance = lastSeason;
  }
  freeAgents = freeAgents.sort((a, b) => overall(b.player) - overall(a.player)).slice(0, FREE_AGENTS_KEPT);

  report.improved = changes.filter((c) => c.after - c.before >= 0.3).sort((a, b) => b.after - b.before - (a.after - a.before)).slice(0, 5);
  report.declined = changes.filter((c) => c.before - c.after >= 0.3).sort((a, b) => a.after - a.before - (b.after - b.before)).slice(0, 5);
  report.retired = report.retired.filter((r) => r.clubId === state.managedClubId || r.age >= 35);

  // Fresh legs; long injuries carry over minus the summer break.
  const squad: CareerState['squad'] = {};
  for (const t of teams) for (const p of t.players) {
    const injury = state.squad[p.id]?.injury;
    const weeksLeft = (injury?.weeksLeft ?? 0) - 10;
    squad[p.id] = { condition: 100, injury: injury && weeksLeft > 0 ? { ...injury, weeksLeft } : undefined };
  }
  const morale = Object.fromEntries(teams.map((t) => [t.id, Math.round(DEFAULT_MORALE + ((state.morale[t.id] ?? DEFAULT_MORALE) - DEFAULT_MORALE) * 0.3)]));
  const keptIds = new Set(teams.flatMap((t) => t.players.map((p) => p.id)));
  const progress = Object.fromEntries(Object.entries(state.progress).filter(([id]) => keptIds.has(id)));
  const individual = Object.fromEntries(Object.entries(state.individual ?? {}).filter(([id]) => keptIds.has(id)));
  const trainingRatings = Object.fromEntries(Object.entries(state.trainingRatings ?? {}).filter(([id]) => keptIds.has(id)));

  // The manager's academy: a year older and better, the 20-year-olds leave, a new intake arrives.
  const managedTeam = teams.find((t) => t.id === state.managedClubId)!;
  const youth = academySummer(state, managedTeam, year, rng, (p, pot) => developPlayer(p, pot, rng));
  for (const { player, potential: pot } of youth.intake) {
    potential[player.id] = pot;
    report.academy.push({ playerId: player.id, name: player.name, position: player.position, age: player.age, potential: pot });
  }
  for (const p of youth.left) delete potential[p.id];

  const season = seasonLabel(year);
  const news: NewsItem[] = [
    { round: 0, kind: 'result', text: `${record.season} finished ${ordinal(record.position)} (board expected ${ordinal(record.expectation)}): ${record.verdict.toLowerCase()}.` },
    ...report.retired.filter((r) => r.clubId === state.managedClubId).map((r) => ({ round: 0, kind: 'recovered' as const, text: `${r.name} (${r.age}) has retired.` })),
    ...report.academy.map((a) => ({ round: 0, kind: 'training' as const, text: `Academy: ${a.name} (${a.age}, ${a.position}) joins the youth academy.` })),
    ...youth.left.map((p) => ({ round: 0, kind: 'recovered' as const, text: `Academy: ${p.name} turned 20 without a first-team place and has left.` })),
    ...report.contractsEnded.map((c) => ({ round: 0, kind: 'injury' as const, text: `${c.name} has left: his contract ran out.` })),
  ];

  // Older careers in the suspended Adriatic League move to their country's league.
  let league = leagueDef(state.leagueId);
  let leagueTeams = teams;
  const moved = state.leagueId === 'adriatic' ? moveFromAdriatic(state.managedClubId, teams, rng) : undefined;
  if (moved) {
    league = moved.league;
    leagueTeams = moved.teams;
    const addedPotential = potentials(moved.added, (state.seed ^ year) >>> 0);
    Object.assign(potential, addedPotential);
    const money = moneyFor(moved.added, (state.seed ^ year) >>> 0, year, addedPotential);
    Object.assign(contracts, money.contracts);
    Object.assign(finances, money.finances);
    for (const t of moved.added) {
      morale[t.id] = DEFAULT_MORALE;
      for (const p of t.players) squad[p.id] = { condition: 100 };
    }
    news.push({ round: 0, kind: 'result', text: `The Regional League has been suspended: from ${season} you play in the ${league.name}.` });
  }

  // Countries of the clubs (generated clubs belong to the league's first country, e.g. VRL clubs to Serbia).
  const clubCountries = { ...(state.clubCountries ?? {}), ...Object.fromEntries(leagueTeams.map((t) => [t.id, clubCountry(state, t.id) ?? league.countries[0]])) };

  // The rest of Europe: a year older, developed, the oldest retire, youngsters join. Clubs that left
  // the league (the suspended Adriatic League) carry on abroad.
  const foreign = state.foreign ? ageForeign([...state.foreign, ...(moved?.removed ?? [])], potential, rng, year) : undefined;
  if (moved && foreign) for (const t of moved.removed) clubCountries[t.id] ??= ADRIATIC_CLUB_COUNTRIES[t.id];

  const newSeason: CareerState = {
    ...state,
    updatedAt: now,
    season,
    leagueId: league.id,
    leagueName: league.name,
    teams: leagueTeams,
    generated: moved ? [...state.generated.filter((id) => leagueTeams.some((t) => t.id === id)), ...moved.added.map((t) => t.id)] : state.generated,
    clubCountries,
    foreign,
    europe: undefined,
    ...seasonFixtures(league, leagueTeams, (state.seed ^ year) >>> 0, year, seasonStart(year), clubCountries),
    playerStats: {},
    squad,
    morale,
    progress,
    potential,
    individual,
    trainingRatings,
    trainingReport: undefined,
    selection: undefined,
    expectation: boardExpectation(leagueTeams, state.managedClubId),
    history: [...state.history, record],
    playerHistory,
    summer: report,
    contracts,
    finances,
    freeAgents,
    negotiations: {},
    matchLog: {},
    academy: youth.academy,
    academyProgress: Object.fromEntries(Object.entries(state.academyProgress ?? {}).filter(([id]) => youth.academy.some((p) => p.id === id))),
    bids: {},
    offers: [],
    transferList: [],
    news: [...state.news, ...news].slice(-60),
  };
  // Staff: a new market of candidates, and now and then a top coach is poached by a bigger club.
  const staff = { ...state.staff };
  const poached: string[] = [];
  for (const [role, member] of Object.entries(staff)) {
    if (member && member.rating >= 15 && rng.chance(0.12)) {
      poached.push(`${member.name} (${role === 'scout' ? 'chief scout' : role === 'physio' ? 'physio' : `${role} coach`})`);
      delete staff[role as keyof typeof staff];
    }
  }
  newSeason.staff = staff;
  newSeason.staffMarket = staffMarket(state.seed, season);
  if (poached.length) newSeason.news = [...newSeason.news, ...poached.map((p) => ({ round: 0, kind: 'injury' as const, text: `Staff: ${p} has been poached by a bigger club.` }))].slice(-60);

  // The summer transfer window opens: AI clubs do their business, and clubs bid for your best players.
  const afterAi = aiTransferWindow(newSeason, rng);
  const offers = summerInterest(afterAi, rng).map((o) => ({ ...o, window: windowKey(afterAi) }));
  // A squad that came out of the summer too small is topped up from the academy.
  const ready = ensureSquads({ ...afterAi, offers, freeAgents: afterAi.freeAgents.slice(0, FREE_AGENTS_KEPT), expectation: boardExpectation(afterAi.teams, state.managedClubId) });
  if (!ready.foreign?.length) return inboxWeek(boardWelcome(ready));
  // European places for the new season, from the season just finished.
  const holders = Object.fromEntries((state.europe?.comps ?? []).filter((c) => c.championId).map((c) => [c.id, c.championId!]));
  const entries = allocateEntries(europeanOrders(state, ready, rng), holders);
  const withEurope = buildEurope(ready, year, entries, (id) => clubById(ready, id));
  // The board sets out the season; summer bids for the manager's players reach the inbox.
  return inboxWeek(boardWelcome({ ...withEurope, fixtures: numberMatchdays(resolveClashes(withEurope.fixtures)) }));
}

function ordinal(n: number) {
  return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
}
