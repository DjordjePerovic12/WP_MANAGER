import { describe, expect, it } from 'vitest';
import { generateLeague, overall } from '../engine';
import {
  ageFactor,
  conditionAfterMatch,
  createCareer,
  LEAGUES,
  managedFixture,
  matchdaySquad,
  matchSetup,
  migrateCareer,
  moraleAfter,
  nextRound,
  pickMatchday,
  recordResult,
  setSelection,
  setTraining,
  simulateFixture,
  simulateRound,
  validStarters,
  MATCHDAY_SIZE,
  CAREER_VERSION,
  type CareerState,
} from '../game';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: ita, realTeams: generateLeague(5, 6), managedClubId: 't3', seed: 42, now: NOW });
const myTeam = (c: CareerState) => c.teams.find((t) => t.id === c.managedClubId)!;
const playRounds = (c: CareerState, n: number) => {
  for (let i = 0; i < n; i++) c = simulateRound(c, nextRound(c)!, NOW);
  return c;
};

describe('matchday squad', () => {
  it('names 13 players with 2 goalkeepers and leaves out injured players', () => {
    let c = start();
    const team = myTeam(c);
    const best = pickMatchday(team, c.squad);
    expect(best).toHaveLength(MATCHDAY_SIZE);
    expect(best.filter((id) => team.players.find((p) => p.id === id)!.position === 'GK')).toHaveLength(2);
    const star = best[2];
    c = { ...c, squad: { ...c.squad, [star]: { condition: 100, injury: { name: 'Broken hand', weeksLeft: 3 } } } };
    expect(matchdaySquad(c, c.managedClubId)).not.toContain(star);
    expect(matchdaySquad(c, c.managedClubId)).toHaveLength(Math.min(MATCHDAY_SIZE, team.players.length - 1));
  });

  it('uses the manager selection and starting seven in the match', () => {
    let c = start();
    const team = myTeam(c);
    const matchday = pickMatchday(team, c.squad);
    // Start the weakest field players instead of the best.
    const field = matchday.slice(2).map((id) => team.players.find((p) => p.id === id)!).sort((a, b) => overall(a) - overall(b));
    const starters = [matchday[1], ...field.slice(0, 6).map((p) => p.id)];
    expect(validStarters(team, matchday, starters)).toEqual(starters);
    c = setSelection(c, { matchday, starters });
    const f = managedFixture(c, 1) ?? managedFixture(c, 2)!;
    const setup = matchSetup(c, f);
    const side = f.homeId === c.managedClubId ? 0 : 1;
    expect(setup.options.lineups![side]).toEqual(starters);
    expect((side === 0 ? setup.home : setup.away).players.map((p) => p.id).sort()).toEqual([...matchday].sort());
    expect(validStarters(team, matchday, [starters[1], ...starters.slice(0, 1), ...starters.slice(2)])).toBeUndefined(); // field player in goal
  });
});

describe('fitness, injuries and morale', () => {
  it('players lose fitness by minutes played and recover during the week', () => {
    expect(conditionAfterMatch(100, 28)).toBeLessThan(conditionAfterMatch(100, 10));
    let c = start();
    const round = nextRound(c)!;
    const f = c.fixtures.find((x) => x.round === round)!;
    const after = recordResult(c, f.id, simulateFixture(c, f), 'simulated', NOW);
    const played = Object.entries(after.playerStats).filter(([, s]) => s.minutes > 15).map(([id]) => id);
    expect(played.length).toBeGreaterThan(5);
    for (const id of played) expect(after.squad[id].condition).toBeLessThan(100);
    c = simulateRound(c, round, NOW);
    for (const id of played) if (!c.squad[id].injury) expect(c.squad[id].condition).toBeGreaterThan(after.squad[id].condition);
  });

  it('match injuries keep players out for weeks, and they come back', () => {
    let c = start();
    let injured: string | undefined;
    for (let r = 0; r < 22 && !injured; r++) {
      c = simulateRound(c, nextRound(c)!, NOW);
      injured = Object.entries(c.squad).find(([, s]) => s.injury)?.[0];
    }
    expect(injured).toBeDefined();
    const weeks = c.squad[injured!].injury!.weeksLeft;
    const club = c.teams.find((t) => t.players.some((p) => p.id === injured))!;
    if (nextRound(c)) expect(matchdaySquad(c, club.id)).not.toContain(injured);
    for (let i = 0; i < weeks && nextRound(c); i++) c = simulateRound(c, nextRound(c)!, NOW);
    if (nextRound(c) || weeks <= 0) expect(c.squad[injured!].injury).toBeUndefined();
  });

  it('a season has a realistic number of injuries', () => {
    let c = start();
    let injuries = 0;
    while (nextRound(c)) {
      const before = new Set(Object.entries(c.squad).filter(([, s]) => s.injury).map(([id]) => id));
      c = simulateRound(c, nextRound(c)!, NOW);
      injuries += Object.entries(c.squad).filter(([id, s]) => s.injury && !before.has(id)).length;
    }
    const perClubPerSeason = injuries / c.teams.length;
    expect(perClubPerSeason).toBeGreaterThan(1);
    expect(perClubPerSeason).toBeLessThan(8);
  });

  it('morale rises with wins and falls with defeats', () => {
    expect(moraleAfter(60, 15, 10)).toBeGreaterThan(60);
    expect(moraleAfter(60, 10, 15)).toBeLessThan(60);
    expect(moraleAfter(100, 20, 5)).toBeLessThanOrEqual(100);
  });
});

describe('training', () => {
  it('improves the focused attributes over a season, young players most', () => {
    const c0 = setTraining(start(), { focus: 'shooting', intensity: 'hard' });
    const c = playRounds(c0, 22);
    const before = myTeam(c0).players;
    const after = myTeam(c).players;
    const gain = (key: 'shootingPower' | 'speed') => after.reduce((s, p, i) => s + p.attrs[key] - before[i].attrs[key], 0);
    expect(gain('shootingPower')).toBeGreaterThan(3);
    expect(gain('speed')).toBe(0);
    expect(c.news.some((n) => n.kind === 'training')).toBe(true);
    expect(ageFactor(19)).toBeGreaterThan(ageFactor(32));
    // Other clubs do not train in this model.
    const other = c0.teams.find((t) => t.id !== c0.managedClubId)!;
    expect(c.teams.find((t) => t.id === other.id)!.players.map((p) => p.attrs)).toEqual(other.players.map((p) => p.attrs));
  });

  it('recovery training restores more fitness than hard training', () => {
    const base = playRounds(start(), 1);
    const fitness = (c: CareerState) => myTeam(c).players.reduce((s, p) => s + c.squad[p.id].condition, 0);
    const hard = simulateRound(setTraining(base, { focus: 'shooting', intensity: 'hard' }), nextRound(base)!, NOW);
    const rest = simulateRound(setTraining(base, { focus: 'recovery', intensity: 'light' }), nextRound(base)!, NOW);
    expect(fitness(rest)).toBeGreaterThan(fitness(hard));
  });
});

describe('saves', () => {
  it('upgrades a version 1 save', () => {
    const { squad, training, morale, progress, news, ...old } = start();
    const migrated = migrateCareer({ ...old, version: 1 } as CareerState);
    expect(migrated.version).toBe(CAREER_VERSION);
    expect(Object.keys(migrated.squad)).toHaveLength(Object.keys(squad).length);
    expect(migrated.training).toEqual(training);
    expect(Object.keys(migrated.morale)).toEqual(Object.keys(morale));
    expect(migrated.progress).toEqual(progress);
    expect(migrated.news).toEqual(news);
  });
});

describe('robustness', () => {
  it('career actions work on an old save that was never upgraded', () => {
    const { squad, training, morale, progress, news, ...old } = start();
    const legacy = { ...old, version: 1 } as CareerState;
    const round = nextRound(legacy)!;
    const mine = managedFixture(legacy, round) ?? legacy.fixtures.find((f) => f.round === round)!;
    const after = recordResult(legacy, mine.id, simulateFixture(legacy, mine), 'live', NOW);
    expect(after.version).toBe(CAREER_VERSION);
    expect(simulateRound(after, round, NOW).fixtures.filter((f) => f.round === round).every((f) => f.result)).toBe(true);
  });
});

describe('flexible squads', () => {
  const team = () => myTeam(start());
  it('keeps any mix of positions the manager picks, with a single goalkeeper if wanted', () => {
    const t = team();
    const gk = t.players.find((p) => p.position === 'GK')!;
    const field = t.players.filter((p) => p.position !== 'GK');
    const centersFirst = [...field].sort((a, b) => Number(b.position === 'CENTER') - Number(a.position === 'CENTER'));
    const wanted = [gk.id, ...centersFirst.slice(0, 12).map((p) => p.id)];
    const picked = pickMatchday(t, start().squad, wanted);
    expect(picked).toEqual(wanted.slice(0, 13));
    expect(picked.filter((id) => t.players.find((p) => p.id === id)!.position === 'GK')).toHaveLength(1);
  });

  it('an unticked player stays out, and an injured one is not silently replaced', () => {
    const t = team();
    const full = pickMatchday(t, start().squad);
    const without = full.slice(0, 12);
    expect(pickMatchday(t, start().squad, without)).toEqual(without);
    const injured = { ...start().squad, [without[5]]: { condition: 100, injury: { name: 'Hamstring strain', weeksLeft: 2 } } };
    expect(pickMatchday(t, injured, without)).toEqual(without.filter((id) => id !== without[5]));
  });

  it('adds a goalkeeper and tops up to seven when the pick is not enough to play', () => {
    const t = team();
    const field = t.players.filter((p) => p.position !== 'GK').slice(0, 3).map((p) => p.id);
    const picked = pickMatchday(t, start().squad, field);
    expect(picked.length).toBe(7);
    expect(t.players.find((p) => p.id === picked[0])!.position).toBe('GK');
  });

  it('accepts a starting seven of six drivers', () => {
    const t = team();
    const gk = t.players.find((p) => p.position === 'GK')!.id;
    const field = [...t.players.filter((p) => p.position !== 'GK')].sort((a, b) => Number(b.position === 'DRIVER') - Number(a.position === 'DRIVER'));
    const matchday = [gk, ...field.slice(0, 12).map((p) => p.id)];
    const starters = [gk, ...field.slice(0, 6).map((p) => p.id)];
    expect(validStarters(t, matchday, starters)).toEqual(starters);
  });
});
