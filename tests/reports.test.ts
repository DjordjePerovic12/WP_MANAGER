import { describe, expect, it } from 'vitest';
import { generateLeague, overall } from '../engine';
import { createCareer, LEAGUES, marketPlayers, nextRound, playerReport, projectOverall, scoutPlayer, simulateRound, type CareerState } from '../game';

const NOW = '2026-10-01T00:00:00.000Z';
const start = () => {
  let c: CareerState = createCareer({ league: LEAGUES.find((l) => l.id === 'ita')!, realTeams: generateLeague(7, 6), managedClubId: 't3', seed: 42, now: NOW });
  for (let i = 0; i < 4; i++) c = simulateRound(c, nextRound(c)!, NOW);
  return c;
};

describe('player reports', () => {
  const career = start();
  const club = career.teams.find((t) => t.id === career.managedClubId)!;

  it('rates your best players as key players and gives reasons', () => {
    const best = [...club.players].sort((a, b) => overall(b) - overall(a))[0];
    const r = playerReport(career, best.id)!;
    expect(r.own).toBe(true);
    expect(r.confidence).toBe('full');
    expect(r.recommendation.tone).toBe('good');
    expect(r.depth.rank).toBe(1);
    expect(r.pros.length).toBeGreaterThan(0);
  });

  it('gives every player of yours a keep / renew / sell verdict', () => {
    const labels = new Set(club.players.map((p) => playerReport(career, p.id)!.recommendation.tone));
    expect(labels.size).toBeGreaterThan(1);
  });

  it('only uses estimates until a player is scouted', () => {
    const target = marketPlayers(career).find((m) => m.clubId && m.player.age < 30)!;
    const before = playerReport(career, target.player.id)!;
    expect(before.confidence).toBe('rough');
    expect(before.strengths).toEqual([]);
    expect(before.money.value).toBeUndefined();
    const scouted = scoutPlayer(career, target.player.id).state;
    const after = playerReport(scouted, target.player.id)!;
    expect(after.confidence).not.toBe('rough');
    expect(after.money.value).toBeGreaterThan(0);
  });

  it("says when you can't afford a player", () => {
    const rich = marketPlayers(career).sort((a, b) => b.askingWage - a.askingWage)[0];
    expect(playerReport(career, rich.player.id)!.recommendation.label).toBe("Can't afford him");
  });

  it('projects young players up and veterans down', () => {
    expect(projectOverall(12, 16, 19)).toBeGreaterThan(12);
    expect(projectOverall(15, 15, 27)).toBe(15);
    expect(projectOverall(15, 15, 33)).toBeLessThan(15);
  });
});
