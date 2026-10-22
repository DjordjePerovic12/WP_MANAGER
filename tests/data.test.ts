import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../engine/match';
import { applyOverrides, enrichFromWorldAquatics, nameKey } from '../data/build';
import { isoDate, normalizeEuropeanAquatics, parseShots, titleCase } from '../data/normalize';
import { isPlayable, ratePlayers, toEngineTeams } from '../data/ratings';
import { computeRealStats } from '../data/realstats';
import type { EaSeason, EaStatRow } from '../data/sources/europeanaquatics';
import { createApp } from '../server/app';
import { openDatabase, schema } from '../server/db';

// ---- A tiny fake season in the European Aquatics format ----

const POSITIONS = ['GK', 'CENTER', 'CDEF', 'DRIVER', 'DRIVER', 'WING', 'POINT', 'DRIVER', 'GK'];

function roster(team: string) {
  return POSITIONS.map((pos, i) => ({
    PlaCatCode: 'ASM', PlaGaraCode: '1', PlaTeamCode: team, PlaCode: `${team}${i + 1}`, PlaNumber: 0,
    PlaSurname: `PLAYER ${team}${'ABCDEFGHI'[i]}`, PlaName: 'Test', PlaHeight: null, PlaBirth: '15/03/1998', PlaNaz: 'SRB',
    PlaRoleEng: pos === 'GK' ? 'Goalkeeper' : null, Staff: 0,
  }));
}

function statRow(team: string, i: number, over: Partial<EaStatRow> = {}): EaStatRow {
  return {
    StaTeamCode: team, StaPlaCode: `${team}${i}`, StaPlaNumber: i, StaTot: '', StaAction: '', StaCenter: '', StaExtraPl: '', Sta5m: '',
    StaPen: '', StaCAttack: '', StaAssists: '', StaTurnovers: '', StaSteals: '', StaBlocks: '', StaSprints: '', StaFoulsC: '', StaFoulsF: '',
    StaFoulsP: '', StaExc: '', ...over,
  } as EaStatRow;
}

function season(statsMatchScore = true): EaSeason {
  const schedule = [{
    OraCatCode: 'ASM', OraGaraCode: '1', OraTurCode: '001', OraGruCode: 1, OraTeamCodeA: 'AAA', OraTeamCodeB: 'BBB',
    OraResA: 3, OraResB: 1, OraStatus: 2, OraCodPub: 'CL27', OraMatchDate: '18/09/2026', OraVenue: 'Belgrade, SRB', OraMatchDescrEng: 'Group A ',
  }];
  const rows: EaStatRow[] = [
    statRow('AAA', 2, { StaTot: '2/3', StaCenter: '2/3', StaFoulsC: '1' }),
    statRow('AAA', 4, { StaTot: '1/4', StaAction: '1/4', StaAssists: '2', StaSprints: '1/1' }),
    statRow('AAA', 3, { StaFoulsC: '3', StaExc: '1' }),
    statRow('BBB', 2, { StaTot: '1/5', StaExtraPl: '1/2', StaAction: '0/3', StaSteals: '1' }),
    { ...statRow('AAA', 0), StaPlaCode: '', StaPlaNumber: null, StaTot: statsMatchScore ? '3/7' : '', StaFoulsC: '4' },
    { ...statRow('BBB', 0), StaPlaCode: '', StaPlaNumber: null, StaTot: statsMatchScore ? '1/5' : '', StaFoulsF: '2' },
  ];
  const startlist = ['AAA', 'BBB'].flatMap((t) => POSITIONS.map((pos, i) => ({ ForTeamCode: t, ForPlaCode: `${t}${i + 1}`, ForPlaNumber: i + 1, ForPlaRoleCode: pos === 'GK' ? 'GK' : null })));
  return {
    events: [{ GaraCatCode: 'ASM', GaraCode: '1', GaraDescrEng: 'Champions League', CatSex: 'M' }],
    teams: [
      { TeamCatCode: 'ASM', TeamCode: 'AAA', TeamName: 'VK ALPHA', TeamNameTV: 'ALPHA', TeamNaz: 'SRB' },
      { TeamCatCode: 'ASM', TeamCode: 'BBB', TeamName: 'CN BETA', TeamNameTV: 'BETA', TeamNaz: 'ESP' },
    ],
    rosters: [...roster('AAA'), ...roster('BBB')],
    schedule,
    matches: {
      'ASM/1/001/1/AAA/BBB': {
        results: { Results: [{ ResTeamA: 3, ResTeamB: 1, Periods: [{ PerNumber: 1, PerResA: 3, PerResB: 1 }] }] },
        startlist: { Startlist: startlist },
        fullstatistics: { FullStatistics: rows, Goalkeepers: [{ ...statRow('BBB', 1), StaTot: '4/7' }] },
      },
    },
  };
}

describe('parsing helpers', () => {
  it('parses dates, shot fractions and names', () => {
    expect(isoDate('21/10/2000')).toBe('2000-10-21');
    expect(isoDate(null)).toBeUndefined();
    expect(parseShots('7/22')).toEqual([7, 22]);
    expect(parseShots('')).toEqual([0, 0]);
    expect(titleCase('SANAHUJA CARNE')).toBe('Sanahuja Carne');
    expect(nameKey('Đukić-Perović')).toBe('DUKICPEROVIC');
  });
});

describe('normalizing European Aquatics data', () => {
  const data = normalizeEuropeanAquatics(season());

  it('creates clubs, players and matches', () => {
    expect(data.clubs.map((c) => c.id)).toEqual(['EA-AAA', 'EA-BBB']);
    expect(data.players).toHaveLength(18);
    expect(data.matches[0]).toMatchObject({ date: '2026-09-18', homeId: 'EA-AAA', score: [3, 1] });
  });

  it('reads per-player and team stats', () => {
    const center = data.playerLines.find((l) => l.playerId === 'EA-AAA2')!;
    expect(center.shots.center).toEqual([2, 3]);
    expect(data.playerLines.find((l) => l.playerId === 'EA-AAA3')!.fouledOut).toBe(true);
    expect(data.teamLines.find((t) => t.clubId === 'EA-AAA')).toMatchObject({ goals: 3, exclusionsCommitted: 4 });
    expect(data.goalkeeperLines[0]).toMatchObject({ playerId: 'EA-BBB1', saves: 4, shotsFaced: 7 });
  });

  it('marks official goalkeepers and infers field positions from stats', () => {
    const pos = (id: string) => data.players.find((p) => p.id === id)!;
    expect(pos('EA-AAA1')).toMatchObject({ position: 'GK', positionSource: 'official' });
    expect(pos('EA-AAA2').position).toBe('CENTER');
    expect(pos('EA-AAA3').position).toBe('CDEF');
    expect(pos('EA-AAA9').positionSource).toBe('official'); // second goalkeeper
  });

  it('skips stats for matches where only the score was published', () => {
    const scoreOnly = normalizeEuropeanAquatics(season(false));
    expect(scoreOnly.matches).toHaveLength(1);
    expect(scoreOnly.playerLines).toHaveLength(0);
    expect(scoreOnly.teamLines).toHaveLength(0);
  });

  it('computes real-world statistics', () => {
    const s = computeRealStats(data);
    expect(s.matches).toBe(1);
    expect(s.goalsPerTeam).toBe(2);
    expect(s.exclusionsDrawnPerTeam).toBe(3); // AAA drew 2, BBB drew 4
  });
});

describe('overrides and World Aquatics enrichment', () => {
  it('applies hand corrections and fills heights by name and birth date', () => {
    const data = normalizeEuropeanAquatics(season());
    applyOverrides(data, { 'EA-AAA4': { position: 'WING', hand: 'L' } });
    expect(data.players.find((p) => p.id === 'EA-AAA4')).toMatchObject({ position: 'WING', hand: 'L', positionSource: 'official' });
    const matched = enrichFromWorldAquatics(data, () => [
      { id: 1, firstName: 'Test', lastName: 'PLAYER AAAB', dateOfBirth: '1998-03-15', nationality: 'SRB', height: 198, gender: 'M' },
    ]);
    expect(matched).toBe(1);
    expect(data.players.find((p) => p.id === 'EA-AAA2')!.heightCm).toBe(198);
  });
});

describe('ratings', () => {
  const data = normalizeEuropeanAquatics(season());

  it('are deterministic and on the 1–20 scale', () => {
    const a = ratePlayers(data);
    expect(ratePlayers(data)).toEqual(a);
    for (const p of a) for (const v of Object.values(p.attrs)) expect(v >= 1 && v <= 20).toBe(true);
  });

  it('produce engine teams that can play a match', () => {
    const teams = toEngineTeams(data);
    expect(teams.every(isPlayable)).toBe(true);
    const result = simulateMatch(teams[0], teams[1], { seed: 5 });
    expect(result.events.at(-1)!.type).toBe('full_time');
  });
});

describe('API', async () => {
  const { db } = openDatabase(':memory:');
  const data = normalizeEuropeanAquatics(season());
  const rated = ratePlayers(data);
  await db.insert(schema.competitions).values(data.competitions);
  await db.insert(schema.clubs).values(data.clubs.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName, country: c.country, rating: 12, playable: true })));
  await db.insert(schema.clubCompetitions).values(data.clubs.map((c) => ({ clubId: c.id, competitionId: 'EA-1' })));
  await db.insert(schema.players).values(rated.map((p) => ({ id: p.id, clubId: p.clubId, firstName: 'Test', lastName: p.name, cap: p.cap || 1, hand: p.hand, handGuessed: true, position: p.position, positionSource: 'inferred' })));
  await db.insert(schema.playerAttributes).values(rated.map((p) => ({ playerId: p.id, ...p.attrs })));
  const app = createApp(db);

  it('lists clubs by competition', async () => {
    const res = await app.request('/api/clubs?competition=EA-1');
    expect(res.status).toBe(200);
    expect((await res.json()).map((c: { id: string }) => c.id).sort()).toEqual(['EA-AAA', 'EA-BBB']);
  });

  it('returns a squad and 404 for unknown clubs', async () => {
    const club = await (await app.request('/api/clubs/EA-AAA')).json();
    expect(club.squad).toHaveLength(9);
    expect((await app.request('/api/clubs/EA-NOPE')).status).toBe(404);
  });

  it('simulates a match deterministically', async () => {
    const play = async () =>
      (await app.request('/api/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ homeId: 'EA-AAA', awayId: 'EA-BBB', seed: 9 }) })).json();
    const [a, b] = [await play(), await play()];
    expect(a.result.score).toEqual(b.result.score);
    expect(a.box.teams[0].goals).toBe(a.result.score[0]);
  });
});

describe('data quality', () => {
  it('ignores impossible birth dates from source typos', async () => {
    const { plausibleBirthDate } = await import('../data/normalize');
    expect(plausibleBirthDate('2026-02-21')).toBeUndefined();
    expect(plausibleBirthDate('1999-05-01')).toBe('1999-05-01');
    expect(plausibleBirthDate(undefined)).toBeUndefined();
  });
});

describe('names', () => {
  it('turns the source\'s "DJ" spelling into Đ', async () => {
    const { fixDj } = await import('../data/normalize');
    expect(fixDj('DJordjije')).toBe('Đordjije');
    expect(fixDj('Djordje Petrovic')).toBe('Đordje Petrovic');
    expect(fixDj('Dejan')).toBe('Dejan');
  });
});
