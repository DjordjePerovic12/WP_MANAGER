// Turn raw European Aquatics captures into the clean DataSet in ./model.ts.

import type { Position } from '../engine/types';
import type {
  Club, Competition, DataSet, GoalkeeperMatchLine, PlayerMatchLine, RealMatch, RealPlayer, Shots, TeamMatchLine,
} from './model';
import { EA_SEASON, matchKey, type EaSeason, type EaStatRow } from './sources/europeanaquatics';

const MEN = 'ASM';
const COMPETITION_TIER: Record<string, number> = { 'Champions League': 1, 'Super Cup': 1, 'Euro Cup': 2, 'Conference Cup': 3, 'Challenger Cup': 4 };

export const clubId = (teamCode: string) => `EA-${teamCode}`;
export const playerId = (plaCode: string) => `EA-${plaCode}`;
const competitionId = (garaCode: string) => `EA-${garaCode}`;

/** "21/10/2000" → "2000-10-21" */
export function isoDate(ddmmyyyy: string | null | undefined): string | undefined {
  const m = ddmmyyyy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

/** The source has occasional typos (e.g. a birth year of 2026): keep only dates that give an age of 14–50. */
export function plausibleBirthDate(iso: string | undefined): string | undefined {
  const year = iso ? Number(iso.slice(0, 4)) : NaN;
  return year >= 1976 && year <= 2012 ? iso : undefined;
}

/** "7/22" → [7, 22]; "" → [0, 0] */
export function parseShots(v: unknown): Shots {
  const m = String(v ?? '').match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const num = (v: unknown) => Number(v) || 0;

/** Letters only, no accents, upper case: "Đukić" → "DUKIC" */
export const nameKey = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D').toUpperCase().replace(/[^A-Z]/g, '');

/** The source writes Đ as "DJ": "DJordjije" → "Đordjije", "Dj" at the start of a word → "Đ". */
export function fixDj(name: string) {
  return name.replace(/(^|[\s-])D[Jj](?=[a-zčćšžđ])/g, '$1Đ');
}

/** "SANAHUJA CARNE" → "Sanahuja Carne" */
export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function shotsOf(row: EaStatRow): PlayerMatchLine['shots'] {
  return {
    action: parseShots(row.StaAction),
    center: parseShots(row.StaCenter),
    extra: parseShots(row.StaExtraPl),
    sixMeter: parseShots(row.Sta5m),
    penalty: parseShots(row.StaPen),
    counter: parseShots(row.StaCAttack),
    total: parseShots(row.StaTot),
  };
}

export function normalizeEuropeanAquatics(raw: EaSeason): DataSet {
  const competitions: Competition[] = raw.events
    .filter((e) => e.GaraCatCode === MEN)
    .map((e) => ({ id: competitionId(e.GaraCode), name: e.GaraDescrEng, tier: COMPETITION_TIER[e.GaraDescrEng] ?? 4 }));

  // Clubs: one per team code, with every competition they play in.
  const clubs = new Map<string, Club>();
  for (const t of raw.teams.filter((t) => t.TeamCatCode === MEN)) {
    clubs.set(t.TeamCode, { id: clubId(t.TeamCode), name: t.TeamName, shortName: t.TeamNameTV || t.TeamName, country: t.TeamNaz, competitions: [] });
  }
  const roster = raw.rosters.filter((p) => p.PlaCatCode === MEN && !p.Staff);
  for (const p of roster) {
    const club = clubs.get(p.PlaTeamCode);
    if (club && !club.competitions.includes(competitionId(p.PlaGaraCode))) club.competitions.push(competitionId(p.PlaGaraCode));
  }

  // Matches and stat lines.
  const matches: RealMatch[] = [];
  const playerLines: PlayerMatchLine[] = [];
  const goalkeeperLines: GoalkeeperMatchLine[] = [];
  const teamLines: TeamMatchLine[] = [];
  const caps = new Map<string, Map<number, number>>(); // player → cap → appearances
  const officialGoalkeepers = new Set<string>();

  for (const m of raw.schedule.filter((s) => s.OraCatCode === MEN && s.OraStatus === 2)) {
    const key = matchKey(m);
    const data = raw.matches[key];
    const id = `EA-${EA_SEASON.code}-${key.replaceAll('/', '-')}`;
    const periods = data?.results.Results[0]?.Periods ?? [];
    matches.push({
      id,
      competitionId: competitionId(m.OraGaraCode),
      round: m.OraMatchDescrEng.trim(),
      date: isoDate(m.OraMatchDate) ?? '',
      venue: m.OraVenue,
      homeId: clubId(m.OraTeamCodeA),
      awayId: clubId(m.OraTeamCodeB),
      score: [m.OraResA ?? 0, m.OraResB ?? 0],
      periods: periods.map((p) => [p.PerResA, p.PerResB] as [number, number]),
    });
    if (!data) continue;

    for (const s of data.startlist.Startlist) {
      const pid = playerId(s.ForPlaCode);
      if (s.ForPlaRoleCode === 'GK') officialGoalkeepers.add(pid);
      const counts = caps.get(pid) ?? new Map<number, number>();
      counts.set(s.ForPlaNumber, (counts.get(s.ForPlaNumber) ?? 0) + 1);
      caps.set(pid, counts);
    }

    const { FullStatistics: rows, Goalkeepers: keepers } = data.fullstatistics;
    // Some matches only have a score published (all stat cells empty): skip their stats.
    const teamGoals = rows.filter((r) => r.StaPlaNumber === null).map((r) => [r.StaTeamCode, parseShots(r.StaTot)[0]] as const);
    const statsMatchScore =
      teamGoals.length === 2 &&
      teamGoals.every(([team, goals]) => goals === (team === m.OraTeamCodeA ? m.OraResA : m.OraResB));
    if (!statsMatchScore) continue;
    for (const row of rows) {
      const team = clubId(row.StaTeamCode);
      if (row.StaPlaNumber === null || !row.StaPlaCode) {
        // Team totals row.
        const opponent = team === clubId(m.OraTeamCodeA) ? clubId(m.OraTeamCodeB) : clubId(m.OraTeamCodeA);
        const shots = shotsOf(row);
        teamLines.push({
          matchId: id, clubId: team, opponentId: opponent, goals: shots.total[0], shots,
          assists: num(row.StaAssists), turnovers: num(row.StaTurnovers), steals: num(row.StaSteals), blocks: num(row.StaBlocks),
          exclusionsCommitted: num(row.StaFoulsC) + num(row.StaFoulsF), penaltyFouls: num(row.StaFoulsP), saves: 0,
        });
        continue;
      }
      playerLines.push({
        matchId: id,
        playerId: playerId(String(row.StaPlaCode)),
        clubId: team,
        cap: row.StaPlaNumber,
        shots: shotsOf(row),
        assists: num(row.StaAssists),
        turnovers: num(row.StaTurnovers),
        steals: num(row.StaSteals),
        blocks: num(row.StaBlocks),
        sprints: parseShots(row.StaSprints),
        exclusionsCenter: num(row.StaFoulsC),
        exclusionsField: num(row.StaFoulsF),
        penaltyFouls: num(row.StaFoulsP),
        fouledOut: num(row.StaExc) > 0,
      });
    }
    const startlist = data.startlist.Startlist;
    for (const gk of keepers) {
      const entry = startlist.find((s) => s.ForTeamCode === gk.StaTeamCode && s.ForPlaNumber === gk.StaPlaNumber);
      if (!entry) continue;
      const [saves, faced] = parseShots(gk.StaTot);
      if (!faced) continue;
      goalkeeperLines.push({ matchId: id, playerId: playerId(entry.ForPlaCode), clubId: clubId(gk.StaTeamCode), saves, shotsFaced: faced });
      officialGoalkeepers.add(playerId(entry.ForPlaCode));
      const line = teamLines.find((t) => t.matchId === id && t.clubId === clubId(gk.StaTeamCode));
      if (line) line.saves += saves;
    }
  }

  // Players: one per player code (a player can be listed in several competitions).
  const players = new Map<string, RealPlayer>();
  for (const p of roster) {
    const id = playerId(p.PlaCode);
    if (players.has(id)) continue;
    const capCounts = [...(caps.get(id) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1]);
    const goalkeeper = p.PlaRoleEng === 'Goalkeeper' || officialGoalkeepers.has(id);
    players.set(id, {
      id,
      firstName: fixDj(p.PlaName.trim()),
      lastName: fixDj(titleCase(p.PlaSurname.trim())),
      birthDate: plausibleBirthDate(isoDate(p.PlaBirth)),
      nationality: p.PlaNaz ?? undefined,
      clubId: clubId(p.PlaTeamCode),
      cap: capCounts[0]?.[0] || undefined,
      heightCm: p.PlaHeight && p.PlaHeight > 100 ? p.PlaHeight : undefined,
      position: goalkeeper ? 'GK' : 'DRIVER',
      positionSource: goalkeeper ? 'official' : 'default',
    });
  }
  inferPositions([...players.values()], playerLines);

  return {
    source: 'European Aquatics (championsleague.europeanaquatics.org, data by Microplus)',
    season: EA_SEASON.label,
    fetchedAt: new Date().toISOString(),
    competitions,
    clubs: [...clubs.values()].filter((c) => c.competitions.length),
    players: [...players.values()],
    matches,
    playerLines,
    goalkeeperLines,
    teamLines,
  };
}

/** Squad shape the engine plays with: of 11 field players, 2 centers, 2 center-defenders, 2 wings, 2 points, the rest drivers. */
const SHAPE: [Position, number][] = [['CENTER', 2 / 11], ['CDEF', 2 / 11], ['WING', 2 / 11], ['POINT', 2 / 11]];

/** Stable 0..1 from a string, so the same player always lands in the same place. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Most sources only mark goalkeepers, so field positions are inferred, per club, in two steps.
 * Positions in water polo are fluid; this aims for a realistic squad shape (see SHAPE).
 * Official positions are kept and count towards the shape.
 * 1. From how each player plays, relative to their own squad:
 *    - center: most shots from 2m
 *    - center-defender: most exclusions committed at 2m (they guard the opposing center)
 *    - wing: highest share of shots on the 6 on 5 (they play the posts and sides)
 *    - point: highest share of outside "action" shots
 * 2. Places still open go to players the stats say nothing about: the tallest to center and
 *    center-defender, left-handers to the wings, the rest spread evenly. Everyone else is a driver.
 * Run it again after merging sources: it starts over for every non-official field player.
 * Correct anyone in data/overrides.json.
 */
export function inferPositions(players: RealPlayer[], lines: PlayerMatchLine[]) {
  const byPlayer = new Map<string, PlayerMatchLine[]>();
  for (const l of lines) byPlayer.set(l.playerId, [...(byPlayer.get(l.playerId) ?? []), l]);

  type Profile = { player: RealPlayer; games: number; attempts: number; center: number; extra: number; action: number; centerExcl: number };
  const byClub = new Map<string, RealPlayer[]>();
  for (const p of players) if (p.position !== 'GK') byClub.set(p.clubId, [...(byClub.get(p.clubId) ?? []), p]);

  for (const field of byClub.values()) {
    const quota = new Map<Position, number>(SHAPE.map(([pos, share]) => [pos, Math.max(1, Math.round(field.length * share))]));
    for (const p of field) if (p.positionSource === 'official' && quota.has(p.position)) quota.set(p.position, quota.get(p.position)! - 1);
    const open = new Set(field.filter((p) => p.positionSource !== 'official'));
    const place = (p: RealPlayer, position: Position, source: RealPlayer['positionSource']) => {
      p.position = position;
      p.positionSource = source;
      quota.set(position, quota.get(position)! - 1);
      open.delete(p);
    };

    // 1. From the stats.
    const profiles: Profile[] = [];
    for (const p of open) {
      const ls = byPlayer.get(p.id);
      if (!ls?.length) continue;
      const sum = (f: (l: PlayerMatchLine) => number) => ls.reduce((s, l) => s + f(l), 0);
      profiles.push({
        player: p,
        games: ls.length,
        attempts: sum((l) => l.shots.total[1]),
        center: sum((l) => l.shots.center[1]),
        extra: sum((l) => l.shots.extra[1]),
        action: sum((l) => l.shots.action[1]),
        centerExcl: sum((l) => l.exclusionsCenter),
      });
    }
    const share = (n: number, x: Profile) => (x.attempts >= 2 ? n / x.attempts : 0);
    const byStats: [Position, (x: Profile) => number][] = [
      ['CENTER', (x) => x.center + share(x.center, x)],
      ['CDEF', (x) => x.centerExcl / x.games],
      ['WING', (x) => share(x.extra, x)],
      ['POINT', (x) => share(x.action, x)],
    ];
    for (const [position, score] of byStats) {
      const ranked = profiles.filter((x) => open.has(x.player) && score(x) > 0).sort((a, b) => score(b) - score(a));
      for (const x of ranked.slice(0, Math.max(0, quota.get(position)!))) place(x.player, position, 'inferred');
    }

    // 2. The squad shape, for players the stats don't place. Players without stats go first.
    const withStats = new Set(profiles.map((x) => x.player));
    const height = (p: RealPlayer) => p.heightCm ?? 190 + hash01(p.id + ':h') * 6;
    const fill: [Position, (p: RealPlayer) => number][] = [
      ['CENTER', height],
      ['CDEF', height],
      ['WING', (p) => (p.hand === 'L' ? 1 : 0) + hash01(p.id + ':w')],
      ['POINT', (p) => hash01(p.id + ':p')],
    ];
    for (const [position, score] of fill) {
      const ranked = [...open].sort((a, b) => Number(withStats.has(a)) - Number(withStats.has(b)) || score(b) - score(a));
      for (const p of ranked.slice(0, Math.max(0, quota.get(position)!))) place(p, position, withStats.has(p) ? 'inferred' : 'default');
    }
    for (const p of open) p.position = 'DRIVER';
    for (const p of open) p.positionSource = withStats.has(p) ? 'inferred' : 'default';
  }
}
