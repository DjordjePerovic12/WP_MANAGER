import { describe, expect, it } from 'vitest';
import { generateLeague, overall, teamRating } from '../engine';
import {
  boardVerdict,
  createCareer,
  developPlayer,
  LEAGUES,
  MAX_SQUAD,
  MIN_SQUAD,
  nextRound,
  seasonAwards,
  simulateRound,
  startNextSeason,
  type CareerState,
} from '../game';
import { createRng } from '../engine/rng';

const ita = LEAGUES.find((l) => l.id === 'ita')!;
const NOW = '2026-10-01T00:00:00.000Z';
const start = () => createCareer({ league: ita, realTeams: generateLeague(5, 6), managedClubId: 't3', seed: 42, now: NOW });
const finishSeason = (c: CareerState) => {
  while (nextRound(c)) c = simulateRound(c, nextRound(c)!, NOW);
  return c;
};

describe('season end', () => {
  const done = finishSeason(start());

  it('cannot start a new season before the old one is over', () => {
    expect(() => startNextSeason(start(), NOW)).toThrow(/not over/);
  });

  it('hands out awards to real players of the league', () => {
    const awards = seasonAwards(done);
    expect(awards.map((a) => a.kind)).toEqual(['top-scorer', 'player-of-season', 'young-player', 'goalkeeper']);
    for (const a of awards) expect(done.teams.find((t) => t.id === a.clubId)!.players.some((p) => p.id === a.playerId)).toBe(true);
  });

  it('judges the season against the board expectation', () => {
    expect(boardVerdict(1, 4).tone).toBe('great');
    expect(boardVerdict(3, 3).tone).toBe('good');
    expect(boardVerdict(8, 3).tone).toBe('bad');
  });
});

describe('player stats detail', () => {
  const done = finishSeason(start());
  const club = done.teams.find((t) => t.id === done.managedClubId)!;

  it('logs every match of the managed club, player by player', () => {
    const ids = new Set(club.players.map((p) => p.id));
    expect(Object.keys(done.matchLog).length).toBeGreaterThan(8);
    for (const [id, log] of Object.entries(done.matchLog)) {
      expect(ids.has(id)).toBe(true);
      expect(log.reduce((s, m) => s + m.goals, 0)).toBe(done.playerStats[id].goals);
      expect(log.reduce((s, m) => s + m.shots, 0)).toBe(done.playerStats[id].shots);
    }
  });

  it('counts the goals each goalkeeper concedes', () => {
    const goals = done.fixtures.reduce((s, f) => s + (f.result ? f.result.score[0] + f.result.score[1] : 0), 0);
    const conceded = Object.values(done.playerStats).reduce((s, p) => s + (p.conceded ?? 0), 0);
    expect(conceded).toBeGreaterThan(goals * 0.9);
    expect(conceded).toBeLessThanOrEqual(goals);
  });

  it('keeps shots, exclusions drawn and fouls in the season history and clears the match log', () => {
    const next = startNextSeason(done, NOW);
    expect(next.matchLog).toEqual({});
    const scorer = Object.entries(done.playerStats).find(([, s]) => s.goals > 3)![0];
    const entry = next.playerHistory[scorer]?.at(-1) ?? done.playerHistory[scorer];
    expect(entry).toMatchObject({ season: '2026-27', shots: done.playerStats[scorer].shots, fouls: done.playerStats[scorer].fouls });
  });
});

describe('next season', () => {
  const done = finishSeason(start());
  const next = startNextSeason(done, NOW);

  it('moves on a year with new fixtures and empty statistics', () => {
    expect(next.season).toBe('2027-28');
    expect(nextRound(next)).toBe(1);
    expect(next.fixtures.every((f) => !f.result && f.date >= '2027-10-01' && f.date < '2028-06-01')).toBe(true);
    expect(next.playerStats).toEqual({});
    expect(next.selection).toBeUndefined();
  });

  it('keeps the season in history, for the club and for every player', () => {
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({ season: '2026-27', clubId: done.managedClubId });
    const scorer = next.history[0].awards[0].playerId;
    expect(next.playerHistory[scorer]?.[0].goals).toBe(done.playerStats[scorer].goals);
  });

  it('ages everyone, brings in academy players and keeps squads playable', () => {
    for (const team of next.teams) {
      expect(team.players.length).toBeGreaterThanOrEqual(MIN_SQUAD);
      expect(team.players.length).toBeLessThanOrEqual(MAX_SQUAD);
      expect(team.players.filter((p) => p.position === 'GK').length).toBeGreaterThanOrEqual(1);
      // AI clubs take their youngsters straight into the first team; the manager's go to the academy.
      if (team.id !== next.managedClubId) expect(team.players.some((p) => p.id.includes('-Y2027-'))).toBe(true);
      expect(new Set(team.players.map((p) => p.cap)).size).toBe(team.players.length);
    }
    expect(next.academy!.some((p) => p.id.includes('-A2027-'))).toBe(true);
    expect(next.academy!.every((p) => p.age <= 19)).toBe(true);
    const before = new Map(done.teams.flatMap((t) => t.players.map((p) => [p.id, p.age])));
    for (const p of next.teams.flatMap((t) => t.players)) if (before.has(p.id)) expect(p.age).toBe(before.get(p.id)! + 1);
    for (const p of next.teams.flatMap((t) => t.players)) expect(next.potential[p.id]).toBeGreaterThan(0);
    for (const id of Object.keys(next.squad)) expect(next.teams.some((t) => t.players.some((p) => p.id === id))).toBe(true);
  });

  it('is deterministic', () => {
    expect(startNextSeason(done, NOW)).toEqual(next);
  });

  it('a new season can be played to the end', () => {
    const second = finishSeason(next);
    expect(nextRound(second)).toBeUndefined();
    expect(startNextSeason(second, NOW).history).toHaveLength(2);
  });
});

describe('development', () => {
  it('young players grow toward their potential and veterans decline', () => {
    const rng = createRng(3);
    const [team] = generateLeague(8, 1);
    const p = team.players.find((x) => x.position === 'DRIVER')!;
    const young = { ...p, age: 19 };
    const old = { ...p, age: 34 };
    let grow = 0;
    let decline = 0;
    for (let i = 0; i < 40; i++) {
      grow += overall(developPlayer(young, overall(young) + 3, rng)) - overall(young);
      decline += overall(developPlayer(old, overall(old), rng)) - overall(old);
    }
    expect(grow / 40).toBeGreaterThan(0.5);
    expect(decline / 40).toBeLessThan(-0.3);
    for (let i = 0; i < 20; i++) expect(overall(developPlayer(young, overall(young) + 1, rng))).toBeLessThanOrEqual(overall(young) + 1.05);
  });

  it('stays stable over five seasons: squads stay valid and the league does not inflate or collapse', () => {
    let c = start();
    const startLevel = c.teams.reduce((s, t) => s + teamRating(t.players), 0) / c.teams.length;
    for (let season = 0; season < 5; season++) c = startNextSeason(finishSeason(c), NOW);
    const endLevel = c.teams.reduce((s, t) => s + teamRating(t.players), 0) / c.teams.length;
    expect(c.season).toBe('2031-32');
    expect(c.history).toHaveLength(5);
    expect(Math.abs(endLevel - startLevel)).toBeLessThan(1.5);
    for (const t of c.teams) {
      expect(t.players.length).toBeGreaterThanOrEqual(MIN_SQUAD);
      expect(t.players.length).toBeLessThanOrEqual(MAX_SQUAD);
      const ages = t.players.map((p) => p.age);
      expect(Math.max(...ages)).toBeLessThan(42);
    }
  });
});
