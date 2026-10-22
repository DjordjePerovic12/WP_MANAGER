// Croatian Water Polo Federation (Hrvatski vaterpolski savez), hvs.hr: the Croatian senior men's league.
//
// hvs.hr is a browser app whose pages load their data from the federation's results system.
// Like the European Aquatics source, we load the public pages in a headless browser, like a normal
// visitor, and record the data the page itself receives. We never call their data API directly.
// Pages are visited slowly (images are not downloaded), and finished matches and player profiles
// are cached forever, so each one is only loaded once.
//
// Only sporting data is kept: club contact details, photos, officials, coaches, heights/weights
// and free-text "about" fields are dropped before anything is written to the cache.

import { chromium, type Page, type Response } from 'playwright';
import type {
  Club, Competition, DataSet, GoalkeeperMatchLine, PlayerMatchLine, RealMatch, RealPlayer, Shots, TeamMatchLine,
} from '../model';
import { fixDj, inferPositions, nameKey, plausibleBirthDate, titleCase } from '../normalize';
import { readCache, throttle, writeCache } from '../http';

const SITE = 'https://hvs.hr';
const NS = 'hvs';
const PAGE_DELAY_MS = 3000;
const LEAGUE_NAME = 'Prvenstvo Hrvatske seniori';
/** Believed to be the 2026-27 league; verified against the page (and looked up in its season list if wrong). */
const CURRENT_GUESS = '522';
const CURRENT_SEASON = '2026/27';
const PREVIOUS_SEASON = '2025/26';
const FINISHED = 'Završeno';
const TIER = 3;

// ---- Raw shapes, as cached (only the fields we keep) ----

export interface HvsGame {
  id: string;
  round: string;
  time: string;              // "2026-09-23 19:45:00"
  status: string;            // "Završeno" when finished
  home: { name: string; clubId: string; score: string };
  away: { name: string; clubId: string; score: string };
}
export interface HvsTableRow { team_id: string; short: string; name: string }
export interface HvsCompetition {
  id: string;
  season: string;            // "2026/27"
  name: string;
  category: string;
  history: { id: string; name: string; season: string }[];
  phases: Record<string, { name: string; order: string }>;
  /** The `active` object of each phase response, keyed by phase id. */
  phaseData: Record<string, Record<string, any>>;
}
export interface HvsLineupEntry { name: string; id: string; number: string; goals: string; shots: string; fouls: string; tip: string; saves: string }
/** Stat cells: uka/ukg total attempts/goals, asa/asg action, esa/esg extra player, csa/csg center, 5sa/5sg penalty,
 *  og exclusions, og+ exclusions drawn, iz turnovers, os steals, bl blocks, sw/sl sprints won/lost; goalkeepers: uka faced, uko saves. */
export type HvsCells = Record<string, string | number> & { name: string; id: string };
export interface HvsMatch {
  utakmica: { id: string; name: string; competition: string; location: string | null; time: string; period: string; status: string };
  /** Team name → result, home team first. Period keys are "1/4" … "4/4". */
  rezultat: Record<string, Record<string, string | number> & { ukupno: string; team_id: string; id: string }>;
  /** Team name → lineup index → player. */
  sastavi: Record<string, Record<string, HvsLineupEntry>>;
  stat?: Record<string, Record<string, number>>;
  gamestat?: { player_stat: Record<string, Record<string, HvsCells>>; goal_stat: Record<string, Record<string, HvsCells>> };
}
export interface HvsPerson { id: string; fname: string; lname: string; date: string | null; club: string | null; country: string | null; position: string | null }

export interface HvsRaw {
  fetchedAt: string;
  current: HvsCompetition;
  previous?: HvsCompetition;
  matches: Record<string, HvsMatch>;
  persons: Record<string, HvsPerson>;
}

export const hvsClubId = (clubId: string) => `HVS-${clubId}`;
export const hvsPlayerId = (personId: string) => `HVS-P${personId}`;
export const hvsMatchId = (matchId: string) => `HVS-M${matchId}`;
const hvsCompetitionId = (competitionId: string) => `HVS-${competitionId}`;

// ---- Reading the competition structure ----

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Every game of a competition, in all its phases (league rounds and play-off ties). */
export function competitionGames(c: HvsCompetition): HvsGame[] {
  const games = new Map<string, HvsGame>();
  const side = (t: any) => ({ name: clean(t?.name), clubId: String(t?.club_id ?? ''), score: String(t?.score ?? '') });
  for (const active of Object.values(c.phaseData)) {
    for (const entry of Object.values(active)) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.type === 'GROUP') {
        for (const [groupName, group] of Object.entries<any>(entry)) {
          if (!group?.kola) continue;
          for (const [kolo, round] of Object.entries<any>(group.kola)) {
            for (const [id, g] of Object.entries<any>(round ?? {})) {
              if (!g?.status || !g['1'] || !g['2']) continue;
              const label = clean(groupName) ? `${clean(kolo)} (${clean(groupName)})` : clean(kolo);
              games.set(id, { id, round: label, time: g.time, status: g.status, home: side(g['1']), away: side(g['2']) });
            }
          }
        }
      } else if (entry.games) {
        // A play-off tie: participants are keyed by ascending numbers, home side first.
        for (const [id, g] of Object.entries<any>(entry.games)) {
          const sides = Object.entries<any>(g)
            .filter(([, v]) => v && typeof v === 'object' && 'club_id' in v)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([, v]) => v);
          if (!g?.status || sides.length !== 2) continue;
          games.set(id, { id, round: `${clean(entry.name)}, ${clean(g.name)}`, time: g.time, status: g.status, home: side(sides[0]), away: side(sides[1]) });
        }
      }
    }
  }
  return [...games.values()].sort((a, b) => a.time.localeCompare(b.time) || Number(a.id) - Number(b.id));
}

/** League tables: team id → full and short club name. */
function competitionTables(c: HvsCompetition): HvsTableRow[] {
  const rows: HvsTableRow[] = [];
  for (const active of Object.values(c.phaseData)) {
    for (const entry of Object.values(active)) {
      if (entry?.type !== 'GROUP') continue;
      for (const group of Object.values<any>(entry)) for (const r of group?.tablica ?? []) rows.push({ team_id: String(r.team_id), short: clean(r.short), name: clean(r.name) });
    }
  }
  return rows;
}

// ---- Fetching ----

type Captured = Map<string, any>;

/** Record the results-system responses a page receives, keyed by "rubrika" (plus ":phase" when present). */
function listen(page: Page): { got: Captured; stop: () => void } {
  const got: Captured = new Map();
  const onResponse = async (res: Response) => {
    const url = new URL(res.url());
    if (url.host !== 'rezultati.hvs.hr' || !url.pathname.startsWith('/api') || !res.ok()) return;
    const rubrika = url.searchParams.get('rubrika');
    if (!rubrika) return;
    const key = rubrika + (url.searchParams.get('phase') ? `:${url.searchParams.get('phase')}` : '');
    if (got.has(key)) return;
    try {
      got.set(key, JSON.parse(await res.text()));
    } catch {
      /* body unavailable (e.g. the page navigated away) */
    }
  };
  page.on('response', onResponse);
  return { got, stop: () => page.off('response', onResponse) };
}

async function waitFor(got: Captured, key: string, timeoutMs = 45000) {
  const start = Date.now();
  while (!got.has(key) && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 250));
  return got.get(key);
}

/** Load a public page (politely spaced from the previous one) and wait for one data response. */
async function visit(page: Page, path: string, key: string, then?: (got: Captured) => Promise<void>) {
  const { got, stop } = listen(page);
  try {
    await page.goto('about:blank');
    await throttle(PAGE_DELAY_MS);
    await page.goto(SITE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const data = await waitFor(got, key);
    if (!data) throw new Error(`${path}: did not receive ${key}`);
    if (then) {
      // Let the app finish rendering before clicking its buttons.
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
      await then(got);
    }
    return got;
  } finally {
    stop();
  }
}

/** Click a tab or phase button by its exact label and wait for the data it loads. */
async function clickFor(page: Page, got: Captured, label: string, key: string) {
  const candidates = page.getByText(label.trim(), { exact: true });
  const count = await candidates.count();
  for (let i = 0; i < count && !got.has(key); i++) {
    await candidates.nth(i).click({ timeout: 5000 }).catch(() => undefined);
    await waitFor(got, key, 8000);
  }
  return got.get(key);
}

async function fetchCompetition(page: Page, id: string, log: (s: string) => void): Promise<HvsCompetition> {
  log(`HVS: competition ${id}…`);
  const got = await visit(page, `/natjecanje/${id}`, 'competition', async (got) => {
    const first = got.get('competition');
    const phases = Object.entries<any>(first.phazes ?? {});
    const activeId = Object.keys(first.active ?? {}).find((k) => first.phazes?.[k]);
    // The page opens on the latest phase; the others load when their button is clicked.
    for (const [phaseId, phase] of phases) {
      if (phaseId === activeId) continue;
      if (!(await clickFor(page, got, phase.name, `competition:${phaseId}`))) log(`  phase ${phase.name}: not received`);
    }
  });
  const first = got.get('competition');
  const activeId = Object.keys(first.active ?? {}).find((k) => first.phazes?.[k]) ?? '';
  const phaseData: Record<string, Record<string, any>> = { [activeId]: first.active };
  for (const phaseId of Object.keys(first.phazes ?? {})) {
    const data = got.get(`competition:${phaseId}`);
    if (data?.active) phaseData[phaseId] = data.active;
  }
  return {
    id,
    season: clean(first.competition?.season),
    name: clean(first.competition?.name),
    category: clean(first.competition?.category),
    history: (first.history ?? []).map((h: any) => ({ id: String(h.id), name: clean(h.name), season: clean(h.season) })),
    phases: Object.fromEntries(Object.entries<any>(first.phazes ?? {}).map(([k, p]) => [k, { name: clean(p.name), order: String(p.order) }])),
    phaseData,
  };
}

/** Keep only the sporting fields of a match page's data. */
function trimMatch(utakmica: any, gamestat: any): HvsMatch {
  const u = utakmica.utakmica;
  const sastavi: HvsMatch['sastavi'] = {};
  for (const [team, lineup] of Object.entries<any>(utakmica.sastavi ?? {})) {
    sastavi[team] = {};
    for (const [k, p] of Object.entries<any>(lineup)) {
      if (!p || typeof p !== 'object') continue; // the coach is a plain string
      sastavi[team][k] = { name: p.name, id: String(p.id), number: String(p.number), goals: String(p.goals), shots: String(p.shots), fouls: String(p.fouls), tip: p.tip, saves: String(p.saves) };
    }
  }
  const rezultat: HvsMatch['rezultat'] = {};
  for (const [team, r] of Object.entries<any>(utakmica.rezultat ?? {})) {
    const { logo: _logo, repka: _repka, ...rest } = r;
    rezultat[team] = rest;
  }
  const cells = (o: any) =>
    Object.fromEntries(Object.entries<any>(o ?? {}).map(([team, rows]) => [team, Object.fromEntries(Object.entries<any>(rows).map(([cap, { link: _l, ...row }]) => [cap, row]))]));
  return {
    utakmica: { id: String(u.id), name: u.name, competition: u.competition, location: u.location, time: u.time, period: u.period, status: u.status },
    rezultat,
    sastavi,
    stat: utakmica.stat,
    gamestat: gamestat?.player_stat ? { player_stat: cells(gamestat.player_stat), goal_stat: cells(gamestat.goal_stat) } : undefined,
  };
}

export async function fetchHvs(options: { maxNewMatches?: number; log?: (s: string) => void } = {}): Promise<void> {
  const log = options.log ?? console.log;
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (compatible; WaterPoloManagerHobby/0.1; non-commercial hobby project)' });
  // Be light on the site: no images, fonts or media, and no analytics.
  await page.route(/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp4)(\?|$)/i, (route) => route.abort());
  await page.route(/google-analytics|googletagmanager|analytics\.google/, (route) => route.abort());
  try {
    // The current season changes every week, so it is refreshed on every run.
    let current = await fetchCompetition(page, CURRENT_GUESS, log);
    const isLeague = (c: { name: string; season: string }, season: string) => clean(c.name) === LEAGUE_NAME && c.season === season;
    if (!isLeague(current, CURRENT_SEASON)) {
      const right = current.history.filter((h) => isLeague(h, CURRENT_SEASON)).at(-1);
      if (!right) throw new Error(`HVS: competition ${CURRENT_GUESS} is "${current.name} ${current.season}" and no ${CURRENT_SEASON} league was found`);
      log(`HVS: ${CURRENT_GUESS} is not the ${CURRENT_SEASON} league; using ${right.id}`);
      current = await fetchCompetition(page, right.id, log);
    }
    writeCache(NS, `competition/${current.id}`, current);

    // The previous season (picked in the page's season list). Once all its games are final, it is never reloaded.
    const prevId = current.history.filter((h) => isLeague(h, PREVIOUS_SEASON)).at(-1)?.id;
    let previous: HvsCompetition | undefined;
    if (prevId) {
      previous = readCache<HvsCompetition>(NS, `competition/${prevId}`);
      const complete = (c: HvsCompetition) => Object.keys(c.phases).every((p) => c.phaseData[p]) && competitionGames(c).every((g) => g.status === FINISHED);
      if (!previous || !complete(previous)) {
        previous = await fetchCompetition(page, prevId, log);
        writeCache(NS, `competition/${prevId}`, previous);
      }
    } else log(`HVS: no ${PREVIOUS_SEASON} league in the season list`);
    writeCache(NS, 'index', { current: current.id, previous: prevId, fetchedAt: new Date().toISOString() });

    // Finished matches: final results never change, so each is loaded once and cached for good.
    const finished = [current, previous].flatMap((c) => (c ? competitionGames(c) : [])).filter((g) => g.status === FINISHED);
    const personIds = new Set<string>();
    let fetched = 0;
    let have = 0;
    for (const g of finished) {
      let match = readCache<HvsMatch>(NS, `match/${g.id}`);
      if (!match) {
        if (options.maxNewMatches !== undefined && fetched >= options.maxNewMatches) continue;
        log(`HVS: match ${g.id} ${g.time.slice(0, 10)} ${g.home.name}–${g.away.name}`);
        try {
          // The detailed statistics load when the "Statistika" tab is clicked; try the page twice before settling without them.
          let gamestat: any;
          let got: Captured | undefined;
          for (let attempt = 1; attempt <= 2 && !gamestat; attempt++) {
            if (attempt > 1) log('  retrying');
            got = await visit(page, `/utakmica/${g.id}`, 'utakmica', async (got) => {
              gamestat = await clickFor(page, got, 'Statistika', 'gamestat');
            }).catch((e) => (attempt < 2 ? undefined : Promise.reject(e)));
          }
          if (!gamestat) log('  no detailed statistics');
          match = trimMatch(got!.get('utakmica'), gamestat);
          if (match.utakmica.status !== FINISHED) {
            log(`  not final yet (${match.utakmica.status}), skipped`);
            continue;
          }
          writeCache(NS, `match/${g.id}`, match);
          fetched++;
        } catch (e) {
          log(`  skipped: ${(e as Error).message}`);
          continue;
        }
      }
      have++;
      for (const lineup of Object.values(match.sastavi)) for (const p of Object.values(lineup)) personIds.add(p.id);
    }
    log(`HVS: ${have}/${finished.length} finished matches (${fetched} new)`);

    // Player profiles (birth date, nationality, club), cached for good.
    let newPersons = 0;
    for (const id of personIds) {
      if (readCache<HvsPerson>(NS, `person/${id}`)) continue;
      try {
        const got = await visit(page, `/igrac/${id}`, 'person');
        const d = got.get('person')?.data;
        if (!d) continue;
        const person: HvsPerson = { id: String(d.id), fname: clean(d.fname), lname: clean(d.lname), date: d.date || null, club: clean(d.club) || null, country: d.country || null, position: d.position || null };
        writeCache(NS, `person/${id}`, person);
        newPersons++;
        if (newPersons % 20 === 0) log(`HVS: ${newPersons} new player profiles…`);
      } catch (e) {
        log(`HVS: player ${id} skipped: ${(e as Error).message}`);
      }
    }
    log(`HVS: ${personIds.size} players (${newPersons} new profiles)`);
  } finally {
    await browser.close();
  }
}

// ---- Offline loading and normalizing ----

/** Read everything fetched so far from the cache, without touching the network. */
export function loadHvsRaw(): HvsRaw | undefined {
  const index = readCache<{ current: string; previous?: string; fetchedAt: string }>(NS, 'index');
  const current = index && readCache<HvsCompetition>(NS, `competition/${index.current}`);
  if (!index || !current) return undefined;
  const previous = index.previous ? readCache<HvsCompetition>(NS, `competition/${index.previous}`) : undefined;
  const matches: Record<string, HvsMatch> = {};
  const persons: Record<string, HvsPerson> = {};
  for (const g of [current, previous].flatMap((c) => (c ? competitionGames(c) : [])).filter((g) => g.status === FINISHED)) {
    const m = readCache<HvsMatch>(NS, `match/${g.id}`);
    if (!m) continue;
    matches[g.id] = m;
    for (const lineup of Object.values(m.sastavi)) {
      for (const p of Object.values(lineup)) {
        const person = persons[p.id] ?? readCache<HvsPerson>(NS, `person/${p.id}`);
        if (person) persons[p.id] = person;
      }
    }
  }
  return { fetchedAt: index.fetchedAt, current, previous, matches, persons };
}

export function loadHvs(): DataSet | undefined {
  const raw = loadHvsRaw();
  return raw && normalizeHvs(raw);
}

const num = (v: unknown) => Number(v) || 0;
const pair = (row: Record<string, unknown> | undefined, attempts: string, goals: string): Shots => [num(row?.[goals]), num(row?.[attempts])];

function shotsOf(row: Record<string, unknown> | undefined, fallback?: HvsLineupEntry): PlayerMatchLine['shots'] {
  return {
    action: pair(row, 'asa', 'asg'),
    center: pair(row, 'csa', 'csg'),
    extra: pair(row, 'esa', 'esg'),
    sixMeter: [0, 0], // not recorded separately by the source
    penalty: pair(row, '5sa', '5sg'),
    counter: [0, 0], // likewise
    total: row ? pair(row, 'uka', 'ukg') : [num(fallback?.goals), num(fallback?.shots)],
  };
}

const seasonLabel = (s: string) => s.replace('/', '-');

/** "Ferdinand Josip Bušelić" → first "Ferdinand Josip", last "Bušelić" (only used when no profile was loaded). */
function splitName(full: string): [string, string] {
  const parts = clean(full).split(' ');
  return parts.length > 1 ? [parts.slice(0, -1).join(' '), parts.at(-1)!] : ['', parts[0] ?? ''];
}
const tidyName = (s: string) => fixDj(titleCase(clean(s)));

export function normalizeHvs(raw: HvsRaw): DataSet {
  const seasons = [raw.current, raw.previous].filter((c): c is HvsCompetition => !!c);
  const competitions: Competition[] = seasons.map((c) => ({ id: hvsCompetitionId(c.id), name: `${c.name} ${c.season}`, tier: TIER }));

  // Clubs: the league tables give the full name ("VK Jadran Split") per team id; games give the club id.
  const clubs = new Map<string, Club>();
  const addClub = (clubId: string, name: string, shortName: string, competitionId: string) => {
    if (!clubId) return;
    const id = hvsClubId(clubId);
    const club = clubs.get(id) ?? { id, name, shortName, country: 'CRO', competitions: [] };
    if (!club.competitions.includes(competitionId)) club.competitions.push(competitionId);
    clubs.set(id, club);
  };
  // Table rows are keyed by team id; match pages link team ids to club ids. Game listings use varying short names.
  const teamToClub = new Map<string, string>();
  for (const m of Object.values(raw.matches)) for (const r of Object.values(m.rezultat)) teamToClub.set(String(r.team_id), String(r.id));
  const byClub = new Map<string, HvsTableRow>();
  const byTeamName = new Map<string, HvsTableRow>();
  for (const c of seasons) {
    for (const r of competitionTables(c)) {
      const club = teamToClub.get(r.team_id);
      if (club) byClub.set(club, r);
      byTeamName.set(nameKey(r.name), r);
    }
  }
  for (const c of seasons) {
    for (const g of competitionGames(c)) {
      for (const s of [g.home, g.away]) {
        const row = byClub.get(s.clubId) ?? byTeamName.get(nameKey(s.name));
        addClub(s.clubId, row?.short || row?.name || s.name, row?.name || s.name, hvsCompetitionId(c.id));
      }
    }
  }

  const matches: RealMatch[] = [];
  const playerLines: PlayerMatchLine[] = [];
  const goalkeeperLines: GoalkeeperMatchLine[] = [];
  const teamLines: TeamMatchLine[] = [];
  const goalkeepers = new Set<string>();
  // player → appearances (season order: current first), for club and cap
  const appearances = new Map<string, { current: boolean; date: string; clubId: string; cap: number }[]>();
  const names = new Map<string, string>();

  for (const c of seasons) {
    const isCurrent = c === raw.current;
    for (const g of competitionGames(c).filter((g) => g.status === FINISHED)) {
      const id = hvsMatchId(g.id);
      const data = raw.matches[g.id];
      const teams = data ? Object.entries(data.rezultat) : [];
      const periods: [number, number][] = [];
      if (teams.length === 2) {
        const keys = Object.keys(teams[0][1]).filter((k) => /^\d+\/\d+$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
        for (const k of keys) periods.push([num(teams[0][1][k]), num(teams[1][1][k])]);
      }
      const home = teams.length === 2 ? teams[0][1].id : g.home.clubId;
      const away = teams.length === 2 ? teams[1][1].id : g.away.clubId;
      // The published total includes penalty shootout goals ("5m"); the match score here is the score after regulation time.
      const shootout = teams.map(([, r]) => num(r['5m']));
      const total: [number, number] = teams.length === 2 ? [num(teams[0][1].ukupno), num(teams[1][1].ukupno)] : [num(g.home.score), num(g.away.score)];
      const score: [number, number] = teams.length === 2 ? [total[0] - shootout[0], total[1] - shootout[1]] : total;
      matches.push({
        id, competitionId: hvsCompetitionId(c.id), round: g.round, date: g.time.slice(0, 10), venue: clean(data?.utakmica.location),
        homeId: hvsClubId(home), awayId: hvsClubId(away), score, periods,
      });
      if (teams.length !== 2) continue;

      const date = g.time.slice(0, 10);
      const lines: PlayerMatchLine[] = [];
      const keepers: GoalkeeperMatchLine[] = [];
      let consistent = true;
      teams.forEach(([teamName, result], side) => {
        const club = hvsClubId(result.id);
        const stats = data.gamestat?.player_stat[teamName];
        let goals = 0;
        for (const p of Object.values(data.sastavi[teamName] ?? {})) {
          const pid = hvsPlayerId(p.id);
          const cap = num(p.number);
          names.set(pid, p.name);
          const list = appearances.get(pid) ?? [];
          list.push({ current: isCurrent, date, clubId: club, cap });
          appearances.set(pid, list);
          if (p.tip === 'GK') goalkeepers.add(pid);
          const cells = Object.values(stats ?? {}).find((r) => String(r.id) === p.id);
          const played = p.tip !== 'RESERVE' || (cells && Object.keys(cells).some((k) => k !== 'name' && k !== 'id')) || num(p.saves) > 0;
          if (!played) continue;
          const shots = shotsOf(cells, data.gamestat ? undefined : p);
          goals += shots.total[0];
          const exclusions = cells ? num(cells.og) : num(p.fouls);
          lines.push({
            matchId: id, playerId: pid, clubId: club, cap, shots,
            assists: 0, turnovers: num(cells?.iz), steals: num(cells?.os), blocks: num(cells?.bl),
            sprints: [num(cells?.sw), num(cells?.sw) + num(cells?.sl)],
            exclusionsCenter: 0, exclusionsField: exclusions, penaltyFouls: 0, fouledOut: exclusions >= 3,
          });
        }
        // Player goals usually include shootout goals (as penalties), but not always.
        if (goals !== score[side] && goals !== total[side]) consistent = false;
        for (const gk of Object.values(data.gamestat?.goal_stat[teamName] ?? {})) {
          const faced = num(gk.uka);
          if (!faced) continue;
          const pid = hvsPlayerId(String(gk.id));
          goalkeepers.add(pid);
          keepers.push({ matchId: id, playerId: pid, clubId: club, saves: num(gk.uko), shotsFaced: faced });
        }
      });
      // Some matches only have a score published, or stats that don't add up: skip their stats.
      if (!consistent) continue;
      playerLines.push(...lines);
      goalkeeperLines.push(...keepers);
      teams.forEach(([, result], side) => {
        const club = hvsClubId(result.id);
        const own = lines.filter((l) => l.clubId === club);
        const sum = (f: (l: PlayerMatchLine) => number) => own.reduce((s, l) => s + f(l), 0);
        const shotSum = (k: keyof PlayerMatchLine['shots']): Shots => [sum((l) => l.shots[k][0]), sum((l) => l.shots[k][1])];
        teamLines.push({
          matchId: id, clubId: club, opponentId: hvsClubId(teams[1 - side][1].id), goals: score[side],
          shots: { action: shotSum('action'), center: shotSum('center'), extra: shotSum('extra'), sixMeter: shotSum('sixMeter'), penalty: shotSum('penalty'), counter: shotSum('counter'), total: shotSum('total') },
          assists: 0, turnovers: sum((l) => l.turnovers), steals: sum((l) => l.steals), blocks: sum((l) => l.blocks),
          exclusionsCommitted: sum((l) => l.exclusionsField), penaltyFouls: 0,
          saves: keepers.filter((k) => k.clubId === club).reduce((s, k) => s + k.saves, 0),
        });
      });
    }
  }

  // Players: everyone in a lineup. Their club is the 2026-27 club they play for; players not (yet) seen this season
  // take the club on their profile when it is one of ours, else their last club of last season.
  const byName = new Map<string, string>();
  for (const club of clubs.values()) for (const n of [club.name, club.shortName, `VK ${club.shortName}`]) byName.set(nameKey(n), club.id);
  const players: RealPlayer[] = [];
  for (const [pid, apps] of appearances) {
    const person = raw.persons[pid.slice('HVS-P'.length)];
    const now = apps.filter((a) => a.current);
    const latest = (list: typeof apps) => [...list].sort((a, b) => b.date.localeCompare(a.date))[0];
    const clubId = now.length ? latest(now).clubId : (person?.club && byName.get(nameKey(person.club))) || latest(apps).clubId;
    const capCounts = new Map<number, number>();
    for (const a of now.length ? now : apps) if (a.cap) capCounts.set(a.cap, (capCounts.get(a.cap) ?? 0) + 1);
    const cap = [...capCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    const [first, last] = person?.lname ? [person.fname, person.lname] : splitName(names.get(pid) ?? '');
    const goalkeeper = goalkeepers.has(pid);
    players.push({
      id: pid,
      firstName: tidyName(first),
      lastName: tidyName(last),
      birthDate: plausibleBirthDate(person?.date ?? undefined),
      nationality: person?.country && /^[A-Z]{3}$/.test(person.country) ? person.country : undefined,
      clubId,
      cap,
      position: goalkeeper ? 'GK' : 'DRIVER',
      positionSource: goalkeeper ? 'official' : 'default',
    });
  }
  inferPositions(players, playerLines);

  return {
    source: 'Hrvatski vaterpolski savez (hvs.hr, data by Furkisport)',
    season: seasonLabel(raw.current.season),
    fetchedAt: raw.fetchedAt,
    competitions,
    clubs: [...clubs.values()],
    players,
    matches,
    playerLines,
    goalkeeperLines,
    teamLines,
  };
}
