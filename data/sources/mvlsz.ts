// Hungarian Water Polo Federation (MVLSZ) public data API (ivr.waterpolo.hu/api/public).
// Open JSON, no key needed. Used for the men's top league (E.ON OB I): clubs,
// games with scores and per-game player stats, and the current rosters.
//
// Politeness: ivr.waterpolo.hu/robots.txt allows everything, but the main site
// disallows crawling match/player pages, so we stay very narrow: two
// competitions, their teams, games and rosters (about 40 requests in all), at
// least 1 s apart, each cached forever. We never page through all players.
//
// Privacy: player records carry administrative and personal data (registration
// numbers, medical dates, emails, birth place, nested user objects). Responses
// are therefore NOT cached raw via getJson: every response is reduced to the
// game fields below in memory, and only that sanitized copy is written to disk.

import type { Hand, Position } from '../../engine/types';
import type {
  Club, Competition, DataSet, GoalkeeperMatchLine, PlayerMatchLine, RealMatch, RealPlayer, Shots, TeamMatchLine,
} from '../model';
import { plausibleBirthDate, titleCase } from '../normalize';
import { readCache, sleep, throttle, USER_AGENT, writeCache } from '../http';

const API = 'https://ivr.waterpolo.hu/api/public';
const NS = 'mvlsz';
const SEASON = '2026-27';
/** E.ON Férfi OB I. Bajnokság, newest first (ids from competitions?filter[league_id]=1). */
const COMPETITIONS = [
  { id: 2203, season: '2026-27' },
  { id: 878, season: '2025-26' },
];
const TIER = 3;
const GAME_INCLUDES = 'competitionRound,facility,gamePlayers,teamGameStats,playerGameStats.player,gameEvents.eventType';

// ---- Sanitized cache shapes (everything on disk looks like this) ----

export interface MvlCompetition { id: number; name: string; shortName: string; season: string }
export interface MvlTeam { id: number; clubId: number; teamId: number; name: string; shortName: string }
export interface MvlPlayer {
  id: number; firstName: string; lastName: string; birthDate?: string; heightCm?: number; weightKg?: number;
  hand?: string; position?: string; clubId?: number; clubName?: string; nationality?: string;
}
/** Per-game player stats: only numeric game fields, no player object. */
export interface MvlStat {
  playerId: number; teamId: number; played: boolean; goals: number; shots: number;
  actionGoals: number; actionShots: number; centerGoals: number; centerShots: number; manUpGoals: number; manUpShots: number;
  freeThrowGoals: number; freeThrowShots: number; penaltyGoals: number; penaltyShots: number; fastBreakGoals: number; fastBreakShots: number;
  assists: number; steals: number; blocks: number; offensiveFouls: number; exclusionsCenter: number; exclusionsField: number;
  /** exclusionsWithPenalty matches the opponent's penalty shots (~90%), so it is the penalty-foul count; penaltiesCaused (penalty_from) is unclear and unused. */
  exclusionsWithPenalty: number; penaltiesCaused: number; fouledOut: boolean; saves: number; savesMissed: number;
}
export interface MvlGame {
  id: number; status: string; date?: string; round: string; venue: string;
  homeTeamId: number; awayTeamId: number; homeScore: number | null; awayScore: number | null;
  periods: [number, number][];
  caps: { playerId: number; teamId: number; cap: number; played: boolean }[];
  stats: MvlStat[];
}
export interface MvlRaw {
  fetchedAt: string;
  competitions: MvlCompetition[];
  teams: Record<number, MvlTeam[]>;          // by competition id
  games: Record<number, MvlGame[]>;          // by competition id
  rosters: Record<number, MvlPlayer[]>;      // by competition team id (current season only)
}

// ---- Fetching ----

interface Page<T> { data: T[]; current_page: number; last_page: number }

/** GET without touching the disk: the caller sanitizes before anything is cached. */
async function getRaw<T>(path: string): Promise<T> {
  const url = `${API}/${path}`;
  for (let attempt = 1; ; attempt++) {
    await throttle(1100);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`GET ${url} -> ${res.status}`);
    await sleep(3000 * attempt);
  }
}

async function getAllPages<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const res = await getRaw<Page<T>>(`${path}&page=${page}`);
    all.push(...res.data);
    if (page >= res.last_page) return all;
  }
}

/** Read a sanitized entry from the cache, or fetch, sanitize and cache it. */
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = readCache<T>(NS, key);
  if (hit !== undefined) return hit;
  const data = await load();
  writeCache(NS, key, data);
  return data;
}

const n = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const pos = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);

export function sanitizeCompetition(c: any, season: string): MvlCompetition {
  return { id: c.id, name: c.name, shortName: c.short_name ?? c.name, season: c.season?.name ?? season };
}

export function sanitizeTeam(t: any): MvlTeam {
  return { id: t.id, clubId: t.club_id, teamId: t.team_id, name: t.name, shortName: t.short_name ?? t.name };
}

/** Keep only the game fields of a player record. Everything else (user, medical, registration, birth place…) is dropped. */
export function sanitizePlayer(p: any): MvlPlayer {
  const out: MvlPlayer = {
    id: p.id,
    firstName: String(p.first_name ?? ''),
    lastName: String(p.last_name ?? ''),
    birthDate: str(p.birth_date)?.slice(0, 10),
    heightCm: pos(p.height_cm),
    weightKg: pos(p.weight_kg),
    hand: str(p.dominant_hand),
    position: str(p.position?.name),
    clubId: pos(p.primary_club_id),
    clubName: str(p.primaryClub?.short_name) && p.primaryClub.short_name !== 'N/A' ? p.primaryClub.short_name : str(p.primaryClub?.name),
    nationality: str(p.user?.citizenship?.[0]),
  };
  for (const k of Object.keys(out) as (keyof MvlPlayer)[]) if (out[k] === undefined) delete out[k];
  return out;
}

function sanitizeStat(s: any): MvlStat {
  return {
    playerId: s.player_id, teamId: s.team_id, played: !!s.is_played, goals: n(s.goals), shots: n(s.shots),
    actionGoals: n(s.action_goals), actionShots: n(s.action_shots), centerGoals: n(s.center_goals), centerShots: n(s.center_shots),
    manUpGoals: n(s.man_up_goals), manUpShots: n(s.man_up_shots), freeThrowGoals: n(s.free_throw_goals), freeThrowShots: n(s.free_throw_shots),
    penaltyGoals: n(s.penalty_goals), penaltyShots: n(s.penalty_shots), fastBreakGoals: n(s.fast_break_goals), fastBreakShots: n(s.fast_break_shots),
    assists: n(s.assists), steals: n(s.steals), blocks: n(s.blocks), offensiveFouls: n(s.offensive_fouls),
    exclusionsCenter: n(s.exclusion_from_center), exclusionsField: n(s.exclusion_from_field), exclusionsWithPenalty: n(s.exclusion_with_penalty),
    penaltiesCaused: n(s.penalty_from), fouledOut: !!s.fouled_outs, saves: n(s.saves), savesMissed: n(s.saves_missed),
  };
}

/** Period scores from the goal events (regular periods only); empty when they don't add up to the final score. */
export function periodsFromEvents(events: any[], home: number | null, away: number | null): [number, number][] {
  const periods: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (const e of events ?? []) {
    if (e.eventType?.code !== 'goal') continue;
    const p = Number(e.game_period_id);
    if (!(p >= 1 && p <= 4)) continue;
    periods[p - 1][e.side === 'home' ? 0 : 1]++;
  }
  const sum = periods.reduce((a, [h, w]) => [a[0] + h, a[1] + w], [0, 0]);
  return sum[0] === home && sum[1] === away && home + away > 0 ? periods : [];
}

export function sanitizeGame(g: any): MvlGame {
  const phase = str(g.competitionPhase?.name);
  const round = str(g.competitionRound?.name);
  return {
    id: g.id,
    status: g.status,
    date: str(g.start_date_time_in_location_time_zone)?.slice(0, 10) ?? str(g.competitionRound?.start_date),
    round: [phase, round].filter(Boolean).join(', '),
    venue: [str(g.facility?.name), str(g.facility?.city)].filter(Boolean).join(', '),
    homeTeamId: g.home_competition_team_id,
    awayTeamId: g.away_competition_team_id,
    homeScore: g.home_team_score ?? null,
    awayScore: g.away_team_score ?? null,
    periods: periodsFromEvents(g.gameEvents ?? [], g.home_team_score, g.away_team_score),
    caps: (g.gamePlayers ?? []).map((p: any) => ({ playerId: p.player_id, teamId: p.competition_team_id, cap: n(p.jersey_number), played: !!p.is_played })),
    stats: (g.playerGameStats ?? []).map(sanitizeStat),
  };
}

/** Download and cache (sanitized) the OB I clubs, games, per-game stats and current rosters. */
export async function fetchMvlsz(options: { log?: (s: string) => void } = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const competitions: MvlCompetition[] = [];
  for (const { id, season } of COMPETITIONS) {
    const comp = await cached(`competition-${id}`, async () => sanitizeCompetition(await getRaw(`competitions/${id}`), season));
    competitions.push(comp);
    const teams = await cached(`teams-${id}`, async () =>
      (await getAllPages<any>(`competition-teams?filter[competition_id]=${id}&per_page=50`)).map(sanitizeTeam));
    const games = await cached(`games-${id}`, async () =>
      (await getAllPages<any>(`games?filter[competition_id]=${id}&include=${GAME_INCLUDES}&per_page=10`)).map(sanitizeGame));
    log(`MVLSZ ${comp.name} ${comp.season}: ${teams.length} teams, ${games.length} games`);
    // Rosters only for the current season: the players the game actually uses.
    if (season !== SEASON) continue;
    for (const team of teams) {
      const roster = await cached(`roster-${team.id}`, async () =>
        (await getAllPages<any>(`players?filter[competition_team_id]=${team.id}&per_page=50`)).map(sanitizePlayer));
      log(`  ${team.name}: ${roster.length} players`);
    }
  }
  writeCache(NS, 'meta', { fetchedAt: new Date().toISOString(), competitions: competitions.map((c) => c.id) });
}

/** Everything fetchMvlsz cached, or undefined if it hasn't run. */
export function readMvlszCache(): MvlRaw | undefined {
  const meta = readCache<{ fetchedAt: string; competitions: number[] }>(NS, 'meta');
  if (!meta) return undefined;
  const raw: MvlRaw = { fetchedAt: meta.fetchedAt, competitions: [], teams: {}, games: {}, rosters: {} };
  for (const id of meta.competitions) {
    const comp = readCache<MvlCompetition>(NS, `competition-${id}`);
    if (!comp) return undefined;
    raw.competitions.push(comp);
    raw.teams[id] = readCache<MvlTeam[]>(NS, `teams-${id}`) ?? [];
    raw.games[id] = readCache<MvlGame[]>(NS, `games-${id}`) ?? [];
    if (comp.season !== SEASON) continue;
    for (const t of raw.teams[id]) raw.rosters[t.id] = readCache<MvlPlayer[]>(NS, `roster-${t.id}`) ?? [];
  }
  return raw;
}

// ---- Normalizing ----

export const clubId = (id: number) => `MVL-${id}`;
export const playerId = (id: number) => `MVL-P${id}`;
export const matchId = (id: number) => `MVL-M${id}`;
const competitionId = (id: number) => `MVL-C${id}`;

/** "left"/"bal" → L, "right"/"jobb" → R */
export function mapHand(v: string | undefined): Hand | undefined {
  const s = v?.toLowerCase() ?? '';
  if (/^(left|bal)/.test(s)) return 'L';
  if (/^(right|jobb)/.test(s)) return 'R';
  return undefined;
}

/** The federation's position names (Hungarian, sometimes English) → engine positions. */
export function mapPosition(v: string | undefined): Position | undefined {
  const s = v?.toLowerCase().trim();
  if (!s) return undefined;
  if (/kapus|goal ?keeper|^gk$/.test(s)) return 'GK';
  if (/hátvéd|bekk|back|defen[cs]e|védő/.test(s)) return 'CDEF';
  if (/center|centre|^cf$/.test(s)) return 'CENTER';
  if (/szélső|wing/.test(s)) return 'WING';
  if (/irányító|point/.test(s)) return 'POINT';
  return 'DRIVER';
}

/** The source uses ISO 3166 alpha-2 citizenship codes; the model wants IOC codes. */
const IOC: Record<string, string> = {
  HU: 'HUN', RS: 'SRB', HR: 'CRO', ME: 'MNE', GR: 'GRE', IT: 'ITA', ES: 'ESP', US: 'USA', RO: 'ROU', SK: 'SVK', AU: 'AUS', PL: 'POL',
  UA: 'UKR', DE: 'GER', NL: 'NED', MT: 'MLT', FR: 'FRA', GB: 'GBR', CA: 'CAN', BR: 'BRA', JP: 'JPN', BA: 'BIH', SI: 'SLO', MK: 'MKD',
  AT: 'AUT', CZ: 'CZE', TR: 'TUR', GE: 'GEO', KZ: 'KAZ', RU: 'RUS', ZA: 'RSA', NZ: 'NZL', AR: 'ARG', CN: 'CHN', IL: 'ISR', SE: 'SWE',
};
export const iocCode = (iso2: string | undefined) => (iso2 ? IOC[iso2.toUpperCase()] ?? iso2.toUpperCase() : undefined);

const shots = (g: number, a: number): Shots => [g, a];

function shotsOf(s: MvlStat): PlayerMatchLine['shots'] {
  return {
    action: shots(s.actionGoals, s.actionShots),
    center: shots(s.centerGoals, s.centerShots),
    extra: shots(s.manUpGoals, s.manUpShots),
    sixMeter: shots(s.freeThrowGoals, s.freeThrowShots),
    penalty: shots(s.penaltyGoals, s.penaltyShots),
    counter: shots(s.fastBreakGoals, s.fastBreakShots),
    total: shots(s.goals, s.shots),
  };
}

function addShots(a: PlayerMatchLine['shots'], b: PlayerMatchLine['shots']) {
  for (const k of Object.keys(a) as (keyof typeof a)[]) a[k] = [a[k][0] + b[k][0], a[k][1] + b[k][1]];
}

/** Build the clean DataSet from the sanitized MVLSZ data. */
export function normalizeMvlsz(raw: MvlRaw): DataSet {
  const current = raw.competitions.find((c) => c.season === SEASON) ?? raw.competitions[0];
  const competitions: Competition[] = raw.competitions.map((c) => ({ id: competitionId(c.id), name: `${c.name} ${c.season}`, tier: TIER }));

  // Clubs: named as the site writes the team in its newest competition.
  const clubs = new Map<string, Club>();
  const teamById = new Map<number, MvlTeam>();      // competition team id → team
  const teamByTeamId = new Map<string, MvlTeam>();  // `${competition}/${team id}` → team (stats use team ids)
  for (const c of raw.competitions) {
    for (const t of raw.teams[c.id] ?? []) {
      teamById.set(t.id, t);
      teamByTeamId.set(`${c.id}/${t.teamId}`, t);
      const id = clubId(t.clubId);
      const club = clubs.get(id) ?? { id, name: t.name, shortName: t.shortName, country: 'HUN', competitions: [] };
      club.competitions.push(competitionId(c.id));
      clubs.set(id, club);
    }
  }

  // Players: the current rosters; the cap is their most worn number this season.
  const capCounts = new Map<number, Map<number, number>>();
  for (const g of raw.games[current.id] ?? []) {
    for (const c of g.caps) {
      if (!c.cap) continue;
      const counts = capCounts.get(c.playerId) ?? new Map<number, number>();
      counts.set(c.cap, (counts.get(c.cap) ?? 0) + 1);
      capCounts.set(c.playerId, counts);
    }
  }
  const players = new Map<string, RealPlayer>();
  for (const [teamId, roster] of Object.entries(raw.rosters)) {
    const team = teamById.get(Number(teamId));
    if (!team) continue;
    for (const p of roster) {
      const id = playerId(p.id);
      if (players.has(id)) continue;
      const position = mapPosition(p.position);
      const caps = [...(capCounts.get(p.id) ?? [])].sort((a, b) => b[1] - a[1]);
      const player: RealPlayer = {
        id,
        firstName: titleCase(p.firstName.trim()),
        lastName: titleCase(p.lastName.trim()),
        birthDate: plausibleBirthDate(p.birthDate),
        nationality: iocCode(p.nationality),
        clubId: clubId(team.clubId),
        cap: caps[0]?.[0],
        heightCm: p.heightCm,
        hand: mapHand(p.hand),
        position: position ?? 'DRIVER',
        positionSource: position ? 'official' : 'default',
      };
      for (const k of Object.keys(player) as (keyof RealPlayer)[]) if (player[k] === undefined) delete player[k];
      players.set(id, player);
    }
  }

  // Matches and lines: finished games only; player lines only for players in the data set.
  const matches: RealMatch[] = [];
  const playerLines: PlayerMatchLine[] = [];
  const goalkeeperLines: GoalkeeperMatchLine[] = [];
  const teamLines: TeamMatchLine[] = [];
  for (const c of raw.competitions) {
    for (const g of raw.games[c.id] ?? []) {
      const home = teamById.get(g.homeTeamId);
      const away = teamById.get(g.awayTeamId);
      if (g.status !== 'completed' || !home || !away || g.homeScore == null || g.awayScore == null || !g.date) continue;
      const id = matchId(g.id);
      matches.push({
        id, competitionId: competitionId(c.id), round: g.round, date: g.date, venue: g.venue,
        homeId: clubId(home.clubId), awayId: clubId(away.clubId), score: [g.homeScore, g.awayScore], periods: g.periods,
      });
      if (!g.stats.length) continue;
      const lines = new Map<number, TeamMatchLine>();
      for (const [team, opp, goals] of [[home, away, g.homeScore], [away, home, g.awayScore]] as const) {
        lines.set(team.teamId, {
          matchId: id, clubId: clubId(team.clubId), opponentId: clubId(opp.clubId), goals,
          shots: { action: [0, 0], center: [0, 0], extra: [0, 0], sixMeter: [0, 0], penalty: [0, 0], counter: [0, 0], total: [0, 0] },
          assists: 0, turnovers: 0, steals: 0, blocks: 0, exclusionsCommitted: 0, penaltyFouls: 0, saves: 0,
        });
      }
      const capOf = new Map(g.caps.map((x) => [x.playerId, x.cap]));
      for (const s of g.stats) {
        const team = teamByTeamId.get(`${c.id}/${s.teamId}`);
        const line = lines.get(s.teamId);
        if (!team || !line || !s.played) continue;
        const sh = shotsOf(s);
        addShots(line.shots, sh);
        line.assists += s.assists; line.turnovers += s.offensiveFouls; line.steals += s.steals; line.blocks += s.blocks;
        line.exclusionsCommitted += s.exclusionsCenter + s.exclusionsField; line.penaltyFouls += s.exclusionsWithPenalty; line.saves += s.saves;
        const pid = playerId(s.playerId);
        if (!players.has(pid)) continue;
        if (s.saves + s.savesMissed > 0) {
          goalkeeperLines.push({ matchId: id, playerId: pid, clubId: clubId(team.clubId), saves: s.saves, shotsFaced: s.saves + s.savesMissed });
        }
        playerLines.push({
          matchId: id, playerId: pid, clubId: clubId(team.clubId), cap: capOf.get(s.playerId) ?? 0, shots: sh,
          assists: s.assists, turnovers: s.offensiveFouls, steals: s.steals, blocks: s.blocks, sprints: [0, 0],
          exclusionsCenter: s.exclusionsCenter, exclusionsField: s.exclusionsField, penaltyFouls: s.exclusionsWithPenalty, fouledOut: s.fouledOut,
        });
      }
      teamLines.push(...lines.values());
    }
  }

  return {
    source: 'MVLSZ (Hungarian Water Polo Federation, ivr.waterpolo.hu public API)',
    season: current.season,
    fetchedAt: raw.fetchedAt,
    competitions,
    clubs: [...clubs.values()],
    players: [...players.values()],
    matches,
    playerLines,
    goalkeeperLines,
    teamLines,
  };
}

/** The OB I data set, offline from the cache (undefined until fetchMvlsz has run). */
export function loadMvlsz(): DataSet | undefined {
  const raw = readMvlszCache();
  return raw ? normalizeMvlsz(raw) : undefined;
}
