import { describe, expect, it } from 'vitest';
import { generateLeague } from '../engine';
import {
  createCareer,
  finalStandings,
  gameWinner,
  leagueDef,
  leagueTable,
  nextMatchday,
  seasonRecord,
  simulateMatchday,
  startNextSeason,
  type CareerState,
} from '../game';

const NOW = '2026-10-01T00:00:00.000Z';
const finish = (c: CareerState) => {
  while (nextMatchday(c) !== undefined) c = simulateMatchday(c, nextMatchday(c)!, NOW);
  return c;
};

describe('playoffs and cup', () => {
  // Croatian format: top 8, best-of-3 quarter- and semi-finals, best-of-5 final; 10 clubs.
  const cro = leagueDef('cro');
  const start = () => createCareer({ league: cro, realTeams: generateLeague(11, 4), managedClubId: 't1', seed: 5, now: NOW });
  const done = finish(start());

  it('plays the playoffs after the regular season, seeded from the table', () => {
    const playoffs = done.competitions.find((c) => c.kind === 'playoff')!;
    const lastLeague = done.fixtures.filter((f) => f.competition === 'league').map((f) => f.date).sort().at(-1)!;
    const games = done.fixtures.filter((f) => f.competition === 'playoffs');
    expect(games.every((f) => f.date > lastLeague)).toBe(true);
    const top8 = leagueTable(done).slice(0, 8).map((r) => r.clubId);
    expect(Object.keys(playoffs.seeds!).sort()).toEqual([...top8].sort());
    expect(playoffs.rounds!.map((r) => r.name)).toEqual(['Quarter-final', 'Semi-final', 'Final']);
    expect(playoffs.championId).toBeDefined();
  });

  it('plays series to the right number of wins, and no more games than needed', () => {
    const playoffs = done.competitions.find((c) => c.kind === 'playoff')!;
    for (const s of playoffs.series!) {
      const need = Math.floor(s.bestOf / 2) + 1;
      const games = done.fixtures.filter((f) => f.seriesId === s.id);
      expect(Math.max(...s.wins)).toBe(need);
      expect(games.length).toBe(s.wins[0] + s.wins[1]);
      expect(games.every((g) => gameWinner(g))).toBe(true); // no draws in knockouts
    }
    expect(playoffs.series!.find((s) => s.round === 3)!.bestOf).toBe(5);
  });

  it('runs a cup for every club with a Final Four in the winter break', () => {
    const cup = done.competitions.find((c) => c.kind === 'cup')!;
    expect(cup.championId).toBeDefined();
    const final = done.fixtures.find((f) => f.competition === 'cup' && f.stage === 'Final')!;
    const semis = done.fixtures.filter((f) => f.competition === 'cup' && f.stage === 'Semi-final');
    expect(semis).toHaveLength(2);
    expect(semis.every((s) => s.date < final.date)).toBe(true);
    expect(final.date.slice(5) >= '12-28' || final.date.slice(5) <= '01-03').toBe(true);
    const clubs = new Set(done.fixtures.filter((f) => f.competition === 'cup').flatMap((f) => [f.homeId, f.awayId]));
    expect(clubs.size).toBe(done.teams.length);
  });

  it('never gives a club two matches on one day', () => {
    const byDay = new Map<string, string[]>();
    for (const f of done.fixtures) byDay.set(f.date, [...(byDay.get(f.date) ?? []), f.homeId, f.awayId]);
    for (const clubs of byDay.values()) expect(new Set(clubs).size).toBe(clubs.length);
  });

  it('scores league games 3 / 2 / 1 / 0 with no draws', () => {
    const league = done.fixtures.filter((f) => f.competition === 'league');
    expect(league.every((f) => gameWinner(f))).toBe(true);
    expect(leagueTable(done).reduce((s, r) => s + r.points, 0)).toBe(3 * league.length);
    expect(leagueTable(done).some((r) => r.shootoutWon > 0)).toBe(true);
  });

  it('ranks the playoff champion first in the final standings and the season record', () => {
    const playoffs = done.competitions.find((c) => c.kind === 'playoff')!;
    expect(finalStandings(done)[0]).toBe(playoffs.championId);
    const record = seasonRecord(done);
    expect(record.championId).toBe(playoffs.championId);
    expect(record.playoffs).toBeDefined();
    expect(record.cup).toBeDefined();
  });

  it('plays a Final Four weekend in the VRL', () => {
    const vrl = leagueDef('vrl');
    const c = finish(createCareer({ league: vrl, realTeams: generateLeague(12, 8), managedClubId: 't2', seed: 9, now: NOW }));
    const games = c.fixtures.filter((f) => f.competition === 'playoffs');
    const semis = games.filter((f) => f.stage === 'Semi-final');
    const final = games.find((f) => f.stage === 'Final')!;
    expect(semis).toHaveLength(2);
    expect(games).toHaveLength(3);
    expect(semis.every((s) => s.date === semis[0].date)).toBe(true);
    expect(Date.parse(final.date) - Date.parse(semis[0].date)).toBe(86_400_000);
  });
});

describe('the suspended Adriatic League', () => {
  it('moves a Montenegrin club to the VRL after the season, without Croatian clubs', () => {
    const ids = ['EA-BDC', 'EA-KOT', 'EA-JHN', 'EA-NBG', 'EA-PAR', 'EA-MLA', 'EA-JUG', 'EA-JSP', 'EA-BAN'];
    const teams = generateLeague(3, ids.length).map((t, i) => ({ ...t, id: ids[i] }));
    const old = createCareer({ league: leagueDef('adriatic'), realTeams: teams, managedClubId: 'EA-BDC', seed: 3, now: NOW });
    const next = startNextSeason(finish(old), NOW);
    expect(next.leagueId).toBe('vrl');
    expect(next.leagueName).toBe('VRL Premier League');
    // The 5 Serbian/Montenegrin clubs stay, joined by the VRL clubs we have no roster for yet (4 names).
    expect(next.teams).toHaveLength(5 + 4);
    for (const gone of ['EA-MLA', 'EA-JUG', 'EA-JSP', 'EA-BAN']) expect(next.teams.some((t) => t.id === gone)).toBe(false);
    const added = next.teams.filter((t) => t.id.startsWith('GEN-vrl'));
    expect(added.map((t) => t.name)).toContain('VK Zemun');
    for (const t of added) {
      expect(next.finances[t.id]).toBeDefined();
      for (const p of t.players) expect(next.contracts[p.id]).toBeDefined();
    }
    expect(next.competitions.map((c) => c.id)).toEqual(['league', 'playoffs', 'playoffs-SRB', 'cup-SRB', 'playoffs-MNE', 'cup-MNE']);
  });
});

describe('the Maltese summer season', () => {
  it('plays the league in summer, then the Summer Knock-Out, then the playoffs', () => {
    const mlt = leagueDef('mlt');
    const c = finish(createCareer({ league: mlt, realTeams: generateLeague(13, 6), managedClubId: 't1', seed: 4, now: NOW }));
    const dates = (id: string) => c.fixtures.filter((f) => f.competition === id).map((f) => f.date).sort();
    const league = dates('league');
    expect(league[0]).toBe('2027-06-26');
    expect(league).toHaveLength(30); // 6 clubs, double round robin
    expect(league.at(-1)! < '2027-08-01').toBe(true);
    const cup = dates('cup');
    const playoffs = dates('playoffs');
    expect(cup[0] > league.at(-1)!).toBe(true);
    expect(playoffs[0] > cup.at(-1)!).toBe(true);
    expect(c.competitions.find((x) => x.kind === 'cup')!.byes).toHaveLength(2);
    expect(c.competitions.find((x) => x.kind === 'playoff')!.championId).toBeDefined();
  });
});

describe('generated clubs', () => {
  it('have the squad rating asked for, without stars far above their level', async () => {
    const { createRng, overall, teamRating } = await import('../engine');
    const { generatedClub } = await import('../game');
    for (const target of [8, 10.5, 13]) {
      const ratings = Array.from({ length: 20 }, (_, i) => generatedClub(createRng(i + 1), 'x', 'X', 'X', target));
      const avg = ratings.reduce((s, t) => s + teamRating(t.players), 0) / ratings.length;
      expect(Math.abs(avg - target)).toBeLessThan(0.3);
      for (const t of ratings) for (const p of t.players) expect(overall(p)).toBeLessThanOrEqual(target + 4.5);
    }
  });
});

describe('VRL national competitions', () => {
  it('plays Serbian and Montenegrin cups and championships next to the VRL', () => {
    const teams = generateLeague(21, 12);
    const countries = Object.fromEntries(teams.map((t, i) => [t.id, i < 8 ? 'SRB' : 'MNE']));
    const c = finish(createCareer({ league: leagueDef('vrl'), realTeams: teams, managedClubId: teams[0].id, seed: 6, now: NOW, countries }));
    const comp = (id: string) => c.competitions.find((x) => x.id === id)!;
    const clubsIn = (id: string) => new Set(c.fixtures.filter((f) => f.competition === id).flatMap((f) => [f.homeId, f.awayId]));
    // National cups: only that country's clubs.
    for (const id of clubsIn('cup-SRB')) expect(countries[id]).toBe('SRB');
    for (const id of clubsIn('cup-MNE')) expect(countries[id]).toBe('MNE');
    expect(comp('cup-SRB').championId).toBeDefined();
    expect(comp('cup-MNE').championId).toBeDefined();
    // National championships after the VRL Final Four, seeded by VRL position.
    const vrlEnd = c.fixtures.filter((f) => f.competition === 'playoffs').map((f) => f.date).sort().at(-1)!;
    for (const id of ['playoffs-SRB', 'playoffs-MNE']) {
      expect(c.fixtures.filter((f) => f.competition === id).every((f) => f.date > vrlEnd)).toBe(true);
      expect(countries[comp(id).championId!]).toBe(id.slice(-3));
    }
    expect(comp('playoffs-SRB').rounds!.map((r) => r.name)).toEqual(['Quarter-final', 'Semi-final', 'Final']);
    expect(comp('playoffs-MNE').rounds!.map((r) => r.name)).toEqual(['Semi-final', 'Final']);
    const record = seasonRecord(c);
    expect(record.nationalName).toBe('Serbian Championship');
    expect(record.cupName).toBe('Serbian Cup');
  });
});
