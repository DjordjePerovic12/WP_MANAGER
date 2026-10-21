// The end of a season and the summer that follows: review and awards, history,
// aging and development, retirements, youth academy, and the new season's fixtures.

import { createRng } from '../engine/rng';
import { overall, teamRating } from '../engine/ratings';
import type { Player, Team } from '../engine/types';
import {
  leagueTable,
  makeSchedule,
  seasonFinished,
  seasonLabel,
  seasonStart,
  seasonYear,
  totalRounds,
  type CareerState,
  type PlayerSeason,
} from './career';
import { boardExpectation, boardVerdict, developPlayer, intakeSize, MAX_SQUAD, MIN_SQUAD, retirementChance, youthIntake } from './development';
import { DEFAULT_MORALE, type NewsItem } from './squad';
import { aiRenews, expectedWage, newContract, nextBudget, prizeMoney, wageBill, type Contract, type FreeAgent, type SeasonFinance } from './finance';

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
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  championId: string;
  championName: string;
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
  const rounds = totalRounds(state);
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

/** The finished season as a history record. */
export function seasonRecord(state: CareerState): SeasonRecord {
  const table = leagueTable(state);
  const mine = table.find((r) => r.clubId === state.managedClubId)!;
  const position = table.indexOf(mine) + 1;
  const name = (id: string) => state.teams.find((t) => t.id === id)?.name ?? id;
  return {
    season: state.season,
    leagueName: state.leagueName,
    clubId: state.managedClubId,
    position,
    points: mine.points,
    played: mine.played,
    won: mine.won,
    drawn: mine.drawn,
    lost: mine.lost,
    goalsFor: mine.goalsFor,
    goalsAgainst: mine.goalsAgainst,
    championId: table[0].clubId,
    championName: name(table[0].clubId),
    expectation: state.expectation,
    verdict: boardVerdict(position, state.expectation).label,
    awards: seasonAwards(state),
    table: table.map((r) => ({ clubId: r.clubId, name: name(r.clubId), points: r.points, goalDifference: r.goalDifference })),
  };
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
      playerHistory[p.id] = [...(playerHistory[p.id] ?? []), { season: state.season, clubId: team.id, clubName: team.name, apps: s.apps, goals: s.goals, assists: s.assists, saves: s.saves, minutes: s.minutes }];
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
    const count = Math.max(intakeSize(players.length, rng), keepers < 2 ? 1 : 0);
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
  const table = leagueTable(state);
  const finances = { ...state.finances };
  for (const team of teams) {
    const f = finances[team.id];
    if (!f) continue;
    const position = table.findIndex((r) => r.clubId === team.id) + 1;
    const prize = prizeMoney(f.revenue, position, table.length);
    const income = f.ledger.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
    const wages = -f.ledger.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0);
    const expected = team.id === state.managedClubId ? state.expectation : boardExpectation(state.teams, team.id);
    const after = { ...f, balance: f.balance + prize };
    const budget = nextBudget(after, position, expected, wageBill(team, contracts));
    const lastSeason: SeasonFinance = { season: state.season, income, wages, prizeMoney: prize, balanceChange: income - wages + prize };
    finances[team.id] = { ...after, ...budget, ledger: [], lastSeason };
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

  const season = seasonLabel(year);
  const news: NewsItem[] = [
    { round: 0, kind: 'result', text: `${record.season} finished ${ordinal(record.position)} (board expected ${ordinal(record.expectation)}): ${record.verdict.toLowerCase()}.` },
    ...report.retired.filter((r) => r.clubId === state.managedClubId).map((r) => ({ round: 0, kind: 'recovered' as const, text: `${r.name} (${r.age}) has retired.` })),
    ...report.academy.map((a) => ({ round: 0, kind: 'training' as const, text: `Academy: ${a.name} (${a.age}, ${a.position}) joins the first team.` })),
    ...report.contractsEnded.map((c) => ({ round: 0, kind: 'injury' as const, text: `${c.name} has left: his contract ran out.` })),
  ];

  return {
    ...state,
    updatedAt: now,
    season,
    teams,
    fixtures: makeSchedule(teams.map((t) => t.id), (state.seed ^ year) >>> 0, seasonStart(year)),
    playerStats: {},
    squad,
    morale,
    progress,
    potential,
    individual,
    trainingRatings,
    trainingReport: undefined,
    selection: undefined,
    expectation: boardExpectation(teams, state.managedClubId),
    history: [...state.history, record],
    playerHistory,
    summer: report,
    contracts,
    finances,
    freeAgents,
    negotiations: {},
    news: [...state.news, ...news].slice(-60),
  };
}

function ordinal(n: number) {
  return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
}
