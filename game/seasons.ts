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
  const report: SummerReport = { fromSeason: state.season, toSeason: seasonLabel(year), retired: [], academy: [], released: [], improved: [], declined: [] };
  const changes: SummerChange[] = [];

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
    // Retirements (never below a playable squad).
    players = players.filter((p) => {
      const retire = rng.chance(retirementChance(p, level)) && players.length > MIN_SQUAD - 2;
      if (retire) {
        report.retired.push({ name: p.name, age: p.age, clubId: team.id });
        delete potential[p.id];
      }
      return !retire;
    });
    // Youth academy: two or three youngsters, more if the squad is thin, a goalkeeper if needed.
    const keepers = players.filter((p) => p.position === 'GK').length;
    const count = Math.max(intakeSize(players.length, rng), keepers < 2 ? 1 : 0);
    const intake = youthIntake({ ...team, players }, rng, year, keepers < 2, count);
    for (const { player, potential: pot } of intake) {
      potential[player.id] = pot;
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
      delete potential[worst.id];
      players = players.filter((p) => p !== worst);
    }
    return { ...team, players: players.sort((a, b) => a.cap - b.cap) };
  });

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
    news: [...state.news, ...news].slice(-60),
  };
}

function ordinal(n: number) {
  return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
}
