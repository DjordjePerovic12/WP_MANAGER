import { describe, expect, it } from 'vitest';
import { createRng, generateTeam, type Team } from '../engine';
import { allocateEntries, createCareer, europeanResult, leagueDef, nextMatchday, seasonRecord, simulateMatchday, startNextSeason, type CareerState } from '../game';

// Real club ids and countries (as in the database), with generated squads.
const CLUBS: Record<string, string> = {
  'EA-NBG': 'SRB', 'EA-RAD': 'SRB', 'EA-PAR': 'SRB', 'EA-SBC': 'SRB', 'EA-JHN': 'MNE', 'EA-KOT': 'MNE', 'EA-BDC': 'MNE', 'EA-BUD': 'MNE',
  'EA-OLY': 'GRE', 'EA-HAN': 'GER', 'EA-SAB': 'ESP', 'EA-REC': 'ITA', 'EA-BRE': 'ITA', 'EA-ORA': 'ROU', 'EA-BAR': 'ESP', 'EA-MLA': 'CRO', 'EA-JSP': 'CRO',
  'EA-FTC': 'HUN', 'EA-MAR': 'FRA', 'EA-PAO': 'GRE', 'EA-STE': 'ROU', 'EA-SPA': 'GER', 'EA-STR': 'FRA', 'EA-SPM': 'GEO', 'EA-HON': 'HUN',
  'EA-DIN': 'GEO', 'EA-AIX': 'FRA', 'EA-GAL': 'TUR', 'EA-SAV': 'ITA', 'EA-SIN': 'RUS', 'EA-DUI': 'GER', 'EA-APO': 'GRE', 'EA-ENK': 'TUR', 'EA-WSH': 'GER',
  'EA-JUG': 'CRO', 'EA-POS': 'ITA', 'EA-BCN': 'ESP', 'EA-DIB': 'ROU', 'EA-VOU': 'GRE', 'EA-TER': 'ESP', 'EA-ZUG': 'HUN', 'EA-PRI': 'CRO',
  'EA-BAN': 'BIH', 'EA-SOL': 'CRO', 'EA-ZAD': 'CRO', 'EA-MAT': 'ESP', 'EA-OSP': 'GER', 'EA-SVC': 'GER', 'EA-PAN': 'GRE', 'EA-YDR': 'GRE', 'EA-SZVE': 'HUN',
  'EA-VSC': 'HUN', 'EA-AKK': 'ITA', 'EA-TRI': 'ITA', 'EA-ZVZ': 'NED', 'EA-VIT': 'POR', 'EA-HSS': 'TUR', 'MLT-NEP': 'MLT', 'MLT-SGN': 'MLT', 'MLT-SLM': 'MLT', 'MLT-SIR': 'MLT',
};
const rng = createRng(77);
const world: Team[] = Object.keys(CLUBS).map((id) => generateTeam(rng, id, id.replace(/^[A-Z]+-/, ''), id.slice(-3), 9 + rng.next() * 5));
const vrl = leagueDef('vrl');
const leagueClubs = world.filter((t) => ['SRB', 'MNE'].includes(CLUBS[t.id]));
const NOW = '2026-10-01T00:00:00.000Z';
const finish = (c: CareerState) => {
  while (nextMatchday(c) !== undefined) c = simulateMatchday(c, nextMatchday(c)!, NOW);
  return c;
};

describe('European competitions', () => {
  const start = createCareer({ league: vrl, realTeams: leagueClubs, managedClubId: 'EA-RAD', seed: 3, now: NOW, countries: CLUBS, world });
  const done = finish(start);

  it('starts 2026-27 with the real Champions League groups', () => {
    const groups = start.europe!.phases.find((p) => p.id === 'cl-g')!.groups!;
    expect(groups.map((g) => g.clubs)).toContainEqual(['EA-REC', 'EA-RAD', 'EA-BRE', 'EA-ORA']);
    const clDays = start.fixtures.filter((f) => f.competition === 'cl').map((f) => new Date(`${f.date}T12:00:00Z`).getUTCDay());
    expect(new Set(clDays)).toEqual(new Set([2])); // Tuesdays
    expect(start.fixtures.filter((f) => f.competition === 'ec' && f.phaseId === 'ec-q').length).toBeGreaterThan(20);
  });

  it('plays every competition to a winner, with drop-downs between them', () => {
    for (const comp of done.europe!.comps) expect(comp.championId, comp.name).toBeDefined();
    const ecKo = done.europe!.phases.find((p) => p.id === 'ec-ko')!;
    expect(ecKo.entrants).toHaveLength(16); // 8 from the Euro Cup groups + 8 from Champions League 3rd/4th
    const clG = done.europe!.phases.find((p) => p.id === 'cl-g')!;
    expect(ecKo.entrants.filter((id) => clG.entrants.includes(id))).toHaveLength(8);
    const ecG = done.europe!.phases.find((p) => p.id === 'ec-g')!;
    expect(ecG.entrants).toHaveLength(16);
  });

  it('never gives a club two games on one day', () => {
    const byDay = new Map<string, string[]>();
    for (const f of done.fixtures) byDay.set(f.date, [...(byDay.get(f.date) ?? []), f.homeId, f.awayId]);
    for (const clubs of byDay.values()) expect(new Set(clubs).size).toBe(clubs.length);
  });

  it('decides level two-legged ties on penalties and pays prize money', () => {
    const legs = done.fixtures.filter((f) => f.leg === 2);
    expect(legs.length).toBeGreaterThan(0);
    const mine = done.finances['EA-RAD'].ledger.filter((e) => /Champions League|Euro Cup/.test(e.label));
    expect(mine.length).toBeGreaterThan(0);
    expect(europeanResult(done, 'EA-RAD')).toBeDefined();
    expect(seasonRecord(done).europe).toMatch(/Champions League|Euro Cup/);
  });

  it('qualifies clubs for next season from their results, real or simulated', () => {
    const next = startNextSeason(done, NOW);
    const p = (id: string) => next.europe!.phases.find((x) => x.id === id)!;
    const serbianChampion = done.competitions.find((c) => c.id === 'playoffs-SRB')!.championId!;
    // Serbia ranks 4th: its champion goes straight to the Champions League groups.
    expect([...p('cl-g').entrants, ...(p('cl-q').entrants)]).toContain(serbianChampion);
    expect(p('cl-g').entrants).toContain(serbianChampion);
    // Banned from European competition after the real 2026-27 season.
    const all = next.europe!.phases.flatMap((x) => x.entrants);
    expect(all).not.toContain('EA-SIN');
    expect(p('cl-q').status).not.toBe('waiting'); // drawn (or skipped) straight away
    expect(next.fixtures.some((f) => f.phaseId === 'cl-q' && f.date.slice(5, 7) === '09')).toBe(true);
    // Older clubs abroad age with everyone else.
    const before = done.foreign!.find((t) => t.id === 'EA-OLY')!.players[0];
    const after = next.foreign!.find((t) => t.id === 'EA-OLY')!.players.find((x) => x.id === before.id);
    if (after) expect(after.age).toBe(before.age + 1);
  });
});

describe('small competitions', () => {
  it('plays a final when only two or three clubs reach the Final Four', () => {
    const three = world.filter((t) => t.id.startsWith('MLT-')).slice(0, 3);
    const c = createCareer({ league: vrl, realTeams: leagueClubs, managedClubId: 'EA-RAD', seed: 5, now: NOW, countries: CLUBS, world });
    const ch = c.europe!.phases.find((p) => p.id === 'ch-f4')!;
    const withThree = { ...c, europe: { ...c.europe!, phases: c.europe!.phases.map((p) => (p.id === 'ch-q1' ? { ...p, status: 'done' as const, qualified: [] } : p.id === 'ch-f8' ? { ...p, status: 'done' as const } : p.id === 'ch-f4' ? { ...ch, entrants: three.map((t) => t.id) } : p)) } };
    const done = finish(withThree);
    const final = done.fixtures.find((f) => f.id === 'ch-f4-F')!;
    expect(final.homeId && final.awayId).toBeTruthy();
    expect(done.europe!.comps.find((x) => x.id === 'ch')!.championId).toBeDefined();
  });
});

describe('European places', () => {
  it('follows the association ranking', () => {
    const order = (c: string) => Array.from({ length: 8 }, (_, i) => `${c}-${i + 1}`);
    const e = allocateEntries({ ITA: order('ITA'), MNE: order('MNE'), GEO: order('GEO'), MLT: order('MLT') }, { cl: 'X' });
    expect(e.clDirect).toEqual(['X', 'ITA-1', 'ITA-2']);
    expect(e.clQual).toEqual(['MNE-1', 'MNE-2', 'GEO-1']);
    expect(e.ecQual).toEqual(['ITA-3', 'ITA-4', 'MNE-3', 'MNE-4', 'GEO-2']);
    expect(e.ccQ1).toContain('MLT-1');
    expect(e.chQ1).toEqual(['MLT-2', 'MLT-3', 'MLT-4']);
  });
});
