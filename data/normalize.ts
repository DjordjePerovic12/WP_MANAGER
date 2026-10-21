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

/** "7/22" → [7, 22]; "" → [0, 0] */
export function parseShots(v: unknown): Shots {
  const m = String(v ?? '').match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const num = (v: unknown) => Number(v) || 0;

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
      firstName: p.PlaName.trim(),
      lastName: titleCase(p.PlaSurname.trim()),
      birthDate: isoDate(p.PlaBirth),
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

/**
 * The source only marks goalkeepers, so field positions are inferred from how each player plays,
 * relative to their own squad (positions in water polo are fluid; this aims for a realistic shape):
 * - center (2 per squad): most shots from 2m
 * - center-defender (2): most exclusions committed at 2m (they guard the opposing center)
 * - wing (2): highest share of shots on the 6 on 5 (they play the posts and sides)
 * - point (2): highest share of outside "action" shots
 * - driver: everyone else (swimmers, sprinters, counterattackers)
 * Players with no matches yet keep the default (driver). Correct anyone in data/overrides.json.
 */
export function inferPositions(players: RealPlayer[], lines: PlayerMatchLine[]) {
  const byPlayer = new Map<string, PlayerMatchLine[]>();
  for (const l of lines) byPlayer.set(l.playerId, [...(byPlayer.get(l.playerId) ?? []), l]);

  type Profile = { player: RealPlayer; games: number; attempts: number; center: number; extra: number; action: number; centerExcl: number };
  const byClub = new Map<string, Profile[]>();
  for (const p of players) {
    const ls = byPlayer.get(p.id);
    if (p.position === 'GK' || !ls?.length) continue;
    const sum = (f: (l: PlayerMatchLine) => number) => ls.reduce((s, l) => s + f(l), 0);
    const profile: Profile = {
      player: p,
      games: ls.length,
      attempts: sum((l) => l.shots.total[1]),
      center: sum((l) => l.shots.center[1]),
      extra: sum((l) => l.shots.extra[1]),
      action: sum((l) => l.shots.action[1]),
      centerExcl: sum((l) => l.exclusionsCenter),
    };
    byClub.set(p.clubId, [...(byClub.get(p.clubId) ?? []), profile]);
  }

  for (const squad of byClub.values()) {
    const open = new Set(squad);
    const assign = (position: Position, count: number, score: (x: Profile) => number) => {
      const ranked = [...open].filter((x) => score(x) > 0).sort((a, b) => score(b) - score(a)).slice(0, count);
      for (const x of ranked) {
        x.player.position = position;
        x.player.positionSource = 'inferred';
        open.delete(x);
      }
    };
    const share = (n: number, x: Profile) => (x.attempts >= 2 ? n / x.attempts : 0);
    assign('CENTER', 2, (x) => x.center + share(x.center, x));
    assign('CDEF', 2, (x) => x.centerExcl / x.games);
    assign('WING', 2, (x) => share(x.extra, x));
    assign('POINT', 2, (x) => share(x.action, x));
    for (const x of open) {
      x.player.position = 'DRIVER';
      x.player.positionSource = 'inferred';
    }
  }
}
