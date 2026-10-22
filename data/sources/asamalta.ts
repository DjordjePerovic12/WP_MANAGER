// Aquatic Sports Association of Malta (asaofmalta.eu): WordPress + SportsPress.
//
// The public SportsPress JSON API lists every event (teams, final score, league,
// season, round). Quarter scores and player lines come from the match-card PDF
// linked in each event's content: machine-generated, so `pdftotext -layout` reads
// it cleanly. We keep only the extracted text (sporting data: caps, names, goals,
// exclusions, quarter scores), never the officials or signatures.
//
// Malta's main season is the summer (BOV Summer League, late June to August,
// followed by the Knock-Out). robots.txt only blocks /wp-admin/. Requests are at
// least 1 s apart, with our user agent, and everything is cached forever.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Club, Competition, DataSet, GoalkeeperMatchLine, PlayerMatchLine, RealMatch, RealPlayer, TeamMatchLine,
} from '../model';
import { nameKey, titleCase } from '../normalize';
import { getJson, readCache, sleep, throttle, USER_AGENT, writeCache } from '../http';

const API = 'https://asaofmalta.eu/wp-json/sportspress/v2';
const NS = 'asamalta';

/** SportsPress season term ids: the summer of year X belongs to season X. */
export const ASA_SEASONS = [
  { id: 153, label: '2026' },
  { id: 137, label: '2025' },
];

/** SportsPress league term ids → our competitions. Playoffs are events of the league itself. */
export const ASA_LEAGUES: { id: number; competition: Competition; cards: boolean }[] = [
  { id: 53, competition: { id: 'MLT-SLP', name: 'BOV Summer League Premier Division', tier: 5 }, cards: true },
  { id: 98, competition: { id: 'MLT-KOP', name: 'Premier Division Knock-Out', tier: 5 }, cards: true },
  { id: 54, competition: { id: 'MLT-SL1', name: 'BOV Summer League First Division', tier: 6 }, cards: true },
  { id: 99, competition: { id: 'MLT-KO1', name: 'First Division Knock-Out', tier: 6 }, cards: true },
];

// ---- Raw shapes (only the fields we use) ----

export interface AsaEvent {
  id: number;
  date: string;                      // local time, "2026-07-22T20:30:00"
  status: string;                    // "publish" once played, "future" before
  title: { rendered: string };
  content: { rendered: string };     // holds the match-card link
  leagues: number[];
  seasons: number[];
  venues: number[];
  teams: number[];                   // [home, away]
  main_results: string[];            // ["14", "18"], or [] before the match
  day: string;                       // round, e.g. "MD11 R2 G3", "PO SF1 - Match 2"
}
export interface AsaTeam { id: number; slug: string; title: { rendered: string }; abbreviation?: string }
export interface AsaVenue { id: number; name: string }
export interface AsaCard { eventId: number; url: string; text?: string; error?: string }

export interface AsaRaw {
  events: AsaEvent[];
  teams: AsaTeam[];
  venues: AsaVenue[];
  cards: Record<number, string>;     // event id → extracted match-card text
}

const eventsUrl = (season: number, league: number, page: number) =>
  `${API}/events?per_page=100&page=${page}&seasons=${season}&leagues=${league}`;
const teamUrl = (id: number) => `${API}/teams/${id}?_fields=id,slug,title,abbreviation`;
const venueUrl = (id: number) => `${API}/venues/${id}?_fields=id,name`;
const cardKey = (eventId: number) => `card-${eventId}`;

/** The match-card PDF linked from an event (always fetched over https). */
export function cardUrl(e: AsaEvent): string | undefined {
  const m = e.content.rendered.match(/href=['"](https?:\/\/asaofmalta\.eu\/wp-content\/uploads\/[^'"]+\.pdf)['"]/i);
  return m?.[1].replace(/^http:/, 'https:');
}

const finished = (e: AsaEvent) => e.status === 'publish' && e.main_results.length === 2 && e.main_results.every((r) => /^\d+$/.test(r));

function pdfToText(pdf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'asamalta-'));
  try {
    const file = join(dir, 'card.pdf');
    writeFileSync(file, pdf);
    for (const bin of ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext']) {
      try {
        return execFileSync(bin, ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 10_000_000 });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    throw new Error('pdftotext not found (install poppler)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function getPdf(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf' } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 3 || res.status < 500) throw new Error(`GET ${url} -> ${res.status}`);
    await sleep(2000 * attempt);
  }
}

/** Download events (JSON), teams, venues and the match cards of finished games. Cached. */
export async function fetchAsaMalta(options: { log?: (s: string) => void } = {}): Promise<void> {
  const log = options.log ?? console.log;
  const events: AsaEvent[] = [];
  for (const season of ASA_SEASONS) {
    for (const league of ASA_LEAGUES) {
      for (let page = 1; ; page++) {
        const list = await getJson<AsaEvent[]>(NS, eventsUrl(season.id, league.id, page));
        events.push(...list);
        if (list.length < 100) break;
      }
    }
  }
  log(`ASA Malta: ${events.length} events`);
  for (const id of new Set(events.flatMap((e) => e.teams).filter((t) => t > 0))) await getJson<AsaTeam>(NS, teamUrl(id));
  for (const id of new Set(events.flatMap((e) => e.venues))) await getJson<AsaVenue>(NS, venueUrl(id));

  const withCards = new Set(ASA_LEAGUES.filter((l) => l.cards).map((l) => l.id));
  let fetched = 0, cached = 0, failed = 0;
  for (const e of events) {
    const url = cardUrl(e);
    if (!finished(e) || !url || !e.leagues.some((l) => withCards.has(l))) continue;
    const hit = readCache<AsaCard>(NS, cardKey(e.id));
    if (hit?.text && hit.url === url) {
      cached++;
      continue;
    }
    try {
      const text = pdfToText(await getPdf(url));
      writeCache(NS, cardKey(e.id), { eventId: e.id, url, text } satisfies AsaCard);
      fetched++;
    } catch (err) {
      failed++;
      log(`  card ${e.id}: ${(err as Error).message}`);
    }
  }
  log(`ASA Malta match cards: ${fetched} new, ${cached} cached, ${failed} failed`);
}

/** Everything fetchAsaMalta stored, from the cache only (undefined if nothing is cached). */
export function loadCachedAsaMalta(): AsaRaw | undefined {
  const events: AsaEvent[] = [];
  for (const season of ASA_SEASONS) {
    for (const league of ASA_LEAGUES) {
      for (let page = 1; ; page++) {
        const list = readCache<AsaEvent[]>(NS, eventsUrl(season.id, league.id, page));
        if (!list) break;
        events.push(...list);
        if (list.length < 100) break;
      }
    }
  }
  if (!events.length) return undefined;
  events.splice(0, events.length, ...new Map(events.map((e) => [e.id, e])).values());
  const teams = [...new Set(events.flatMap((e) => e.teams))].map((id) => readCache<AsaTeam>(NS, teamUrl(id))).filter((t) => t !== undefined);
  const venues = [...new Set(events.flatMap((e) => e.venues))].map((id) => readCache<AsaVenue>(NS, venueUrl(id))).filter((v) => v !== undefined);
  const cards: Record<number, string> = {};
  for (const e of events) {
    const text = readCache<AsaCard>(NS, cardKey(e.id))?.text;
    if (text) cards[e.id] = text;
  }
  return { events, teams, venues, cards };
}

export function loadAsaMalta(): DataSet | undefined {
  const raw = loadCachedAsaMalta();
  return raw && normalizeAsaMalta(raw);
}

// ---- Match-card parsing ----

export interface CardPlayer {
  cap: number;
  name: string;        // as printed, without the captain mark: "Dino ZAMMIT"
  captain: boolean;
  goals: number;
  exclusions: number;  // personal fouls (exclusions) listed in the three exclusion slots
}
export interface CardTeam { name: string; score?: number; players: CardPlayer[] }
export interface MatchCard {
  title: string;                 // the card's "Name:" field (often empty or generic)
  teams: CardTeam[];             // [white, blue]; white is the home side
  periods: [number, number][];   // quarter scores, white first
  events: { goals: number; fouls: number; timeouts: number; other: string[] }; // play-by-play summary
}

// An exclusion slot: "-", or a quarter and time, sometimes squeezed or cut: "Q1 07:33", "Q1 16.80", "Q405:02", "Q2 53", "Q1 03:".
const SLOT = String.raw`(?:-|Q\d\s*\d{0,2}(?:[:.]\d{0,2})?)`;
// Names start at the left edge or are centered (staff names are further in and have no cap/goals).
const PLAYER_ROW = new RegExp(String.raw`^\s{0,30}(\S.*?)\s{2,}(\d{1,2})\s+(\d{1,2})\s+(${SLOT})\s+(${SLOT})\s+(${SLOT})(?:\s|$)`);

/**
 * Read one match card (pdftotext -layout output). The page has two team blocks, each with a
 * "Name # Goals Time Exclusion 1..3" table, a partial-score box (quarters 1–4), and a
 * play-by-play grid that only records goals, exclusion fouls ("Foul") and timeouts:
 * no missed or saved shots, no penalties and no goalkeeper marks.
 */
export function parseMatchCard(text: string): MatchCard {
  const lines = text.split(/\r?\n/);
  const title = text.match(/Name:(.*?)(?:Start:|$)/m)?.[1].trim() ?? '';
  const teams: CardTeam[] = [];
  const partial = new Map<number, [number, number]>();
  let pbpStarted = false;
  // Play-by-play: the column where each quarter starts, and the running score after each goal.
  let quarterCols: number[] = [];
  const goalScores: { quarter: number; score: [number, number] }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Team header: "<NAME>   [Partial Score]" just above (or on) the "Final Score" line.
    if (line.includes('Final Score')) {
      let name = line.slice(0, line.indexOf('Final Score')).trim();
      for (let j = i - 1; !name && j >= Math.max(0, i - 3); j--) name = lines[j].replace(/Partial Score.*$/, '').trim();
      let score: number | undefined;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const m = lines[j].match(/(?:^|\s{3,})(\d{1,2})\s{3,}\d{1,2}\s{3,}[WB](?:\s|$)/); // "14   2   W" (score, timeouts, cap colour), maybe after a staff name
        if (m) {
          score = Number(m[1]);
          break;
        }
      }
      teams.push({ name: name.replace(/\s{2,}.*$/, ''), score, players: [] });
      continue;
    }
    if (/^\s+Quarter 1\s+Quarter 2/.test(line)) pbpStarted = true;
    if (pbpStarted && !quarterCols.length && /Time\s+W\s+B\s+Event/.test(line)) quarterCols = [...line.matchAll(/Time(?=\s+W\s+B)/g)].map((m) => m.index);
    if (quarterCols.length) {
      for (const g of line.matchAll(/Goal\s+(\d{1,2})-(\d{1,2})/g)) {
        const quarter = quarterCols.filter((c) => c <= g.index + 2).length;
        if (quarter) goalScores.push({ quarter, score: [Number(g[1]), Number(g[2])] });
      }
    }
    // Partial score box (before the play-by-play grid): "... 2 ... 4 5" at the end of a line.
    if (!pbpStarted) {
      const p = line.match(/\s{5,}([1-4])\s{5,}(\d{1,2})\s{5,}(\d{1,2})\s*$/);
      if (p && !partial.has(Number(p[1]))) partial.set(Number(p[1]), [Number(p[2]), Number(p[3])]);
    }
    const row = line.match(PLAYER_ROW);
    if (row && teams.length) {
      const raw = row[1].trim();
      teams[teams.length - 1].players.push({
        cap: Number(row[2]),
        // Older cards glue the names: "StevieCAMILLERI(C)" → "Stevie CAMILLERI".
        name: raw.replace(/\s*\(C\)\s*$/i, '').replace(/(\p{Ll})(\p{Lu}{2,})/gu, '$1 $2').trim(),
        captain: /\(C\)\s*$/i.test(raw),
        goals: Number(row[3]),
        exclusions: [row[4], row[5], row[6]].filter((s) => s !== '-').length,
      });
    }
  }

  // Quarters 1–3 are printed on one line each; quarter 4 is often split, so derive it from the final.
  let periods: [number, number][] = [];
  const [w, b] = [teams[0]?.score, teams[1]?.score];
  if (w !== undefined && b !== undefined && [1, 2, 3].every((q) => partial.has(q))) {
    const first = [1, 2, 3].map((q) => partial.get(q)!);
    const q4: [number, number] = [w - first.reduce((s, p) => s + p[0], 0), b - first.reduce((s, p) => s + p[1], 0)];
    if (q4[0] >= 0 && q4[1] >= 0) periods = [...first, q4];
  }
  // No partial-score box (some cards leave it blank): use the running score of the last goal in each quarter.
  if (!periods.length && w !== undefined && b !== undefined && goalScores.length) {
    const cumulative: [number, number][] = [];
    for (let q = 1; q <= 4; q++) {
      const prev = cumulative[q - 2] ?? [0, 0];
      cumulative.push(goalScores.filter((g) => g.quarter === q).reduce<[number, number]>((best, g) => (g.score[0] + g.score[1] >= best[0] + best[1] ? g.score : best), prev));
    }
    const last = cumulative[3];
    if (last[0] === w && last[1] === b) periods = cumulative.map((c, i) => [c[0] - (cumulative[i - 1]?.[0] ?? 0), c[1] - (cumulative[i - 1]?.[1] ?? 0)]);
  }

  const words = text.match(/\b(Goal|Foul|Timeout|Penalty|Miss(?:ed)?|Save[ds]?|Shot)\b/g) ?? [];
  const count = (w: string) => words.filter((x) => x === w).length;
  const events = { goals: count('Goal'), fouls: count('Foul'), timeouts: count('Timeout'), other: [...new Set(words.filter((x) => !['Goal', 'Foul', 'Timeout'].includes(x)))] };
  return { title, teams: teams.slice(0, 2), periods, events };
}

/** "Dino ZAMMIT" → { firstName: "Dino", lastName: "Zammit" }; the surname is the trailing upper-case words. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const tokens = full.trim().split(/\s+/);
  const upper = (t: string) => /\p{L}/u.test(t) && t === t.toUpperCase();
  let cut = tokens.length;
  while (cut > 0 && upper(tokens[cut - 1])) cut--;
  if (cut === 0) cut = 1; // all upper case ("M BONELLO DUPUIS"): the first word is the first name
  if (cut === tokens.length) cut = tokens.length - 1;
  return { firstName: tokens.slice(0, cut).join(' '), lastName: titleCase(tokens.slice(cut).join(' ')) };
}

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'");

/** Club names without sponsors, keyed by the SportsPress abbreviation (titles and slugs carry sponsors). */
const CLUB_NAMES: Record<string, string> = {
  NEP: 'Neptunes', SGN: 'San Giljan', SLM: 'Sliema', SIR: 'Sirens', EXI: 'Exiles', VLT: 'Valletta United',
  BBG: 'Birżebbuġa', BAR: 'Barracudas', MSK: 'Marsaskala', MXK: 'Marsaxlokk', OTT: 'Otters', TXB: "Ta' Xbiex",
};

function clubName(t: AsaTeam): string {
  return CLUB_NAMES[t.abbreviation ?? ''] ?? titleCase(t.slug.replace(/-(asc|sc)$/, '').replace(/-/g, ' '));
}

export function normalizeAsaMalta(raw: AsaRaw): DataSet {
  const leagueOf = new Map(ASA_LEAGUES.map((l) => [l.id, l.competition]));
  const teamById = new Map(raw.teams.map((t) => [t.id, t]));
  const venueById = new Map(raw.venues.map((v) => [v.id, v.name]));
  const clubIdOf = (team: number) => {
    const t = teamById.get(team);
    return `MLT-${(t?.abbreviation || t?.slug || String(team)).toUpperCase().replace(/[^A-Z0-9]+/g, '')}`;
  };

  const clubs = new Map<string, Club>();
  const usedCompetitions = new Map<string, Competition>();
  const matches: RealMatch[] = [];
  const playerLines: PlayerMatchLine[] = [];
  const teamLines: TeamMatchLine[] = [];
  // Player appearances before ids are assigned: name key → club → appearances.
  type Appearance = { line: PlayerMatchLine; firstName: string; lastName: string; date: string; season: number };
  const appearances: Appearance[] = [];

  const events = [...raw.events].filter(finished).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const e of events) {
    const competition = e.leagues.map((l) => leagueOf.get(l)).find((c) => c);
    if (!competition || e.teams.length !== 2 || e.teams.some((t) => t <= 0)) continue;
    usedCompetitions.set(competition.id, competition);
    const [homeId, awayId] = e.teams.map(clubIdOf);
    for (const [team, id] of [[e.teams[0], homeId], [e.teams[1], awayId]] as const) {
      const t = teamById.get(team);
      const club = clubs.get(id) ?? { id, name: t ? clubName(t) : id, shortName: t?.abbreviation || id.slice(4), country: 'MLT', competitions: [] };
      if (!club.competitions.includes(competition.id)) club.competitions.push(competition.id);
      clubs.set(id, club);
    }
    const score: [number, number] = [Number(e.main_results[0]), Number(e.main_results[1])];
    const matchId = `MLT-M${e.id}`;
    const text = raw.cards[e.id];
    const card = text ? parseMatchCard(text) : undefined;
    // The card's white team is normally the home side; swap if its scores say otherwise.
    let sides = card?.teams;
    let periods = card?.periods ?? [];
    if (card && sides?.length === 2 && score[0] !== score[1] && sides[0].score === score[1] && sides[1].score === score[0]) {
      sides = [sides[1], sides[0]];
      periods = periods.map(([a, b]) => [b, a]);
    }
    matches.push({
      id: matchId, competitionId: competition.id, round: decode(e.day || card?.title || ''), date: e.date.slice(0, 10),
      venue: venueById.get(e.venues[0]) ?? '', homeId, awayId, score, periods,
    });
    if (!sides || sides.length !== 2) continue;

    sides.forEach((side, s) => {
      const clubId = s === 0 ? homeId : awayId;
      const lines: PlayerMatchLine[] = [];
      for (const p of side.players) {
        if (!/\p{L}/u.test(p.name)) continue;
        const line: PlayerMatchLine = {
          matchId, playerId: '', clubId, cap: p.cap,
          shots: { action: [0, 0], center: [0, 0], extra: [0, 0], sixMeter: [0, 0], penalty: [0, 0], counter: [0, 0], total: [p.goals, p.goals] },
          assists: 0, turnovers: 0, steals: 0, blocks: 0, sprints: [0, 0],
          exclusionsCenter: 0, exclusionsField: p.exclusions, penaltyFouls: 0, fouledOut: p.exclusions >= 3,
        };
        lines.push(line);
        appearances.push({ line, ...splitName(p.name), date: e.date, season: e.seasons[0] ?? 0 });
      }
      playerLines.push(...lines);
      const goals = score[s];
      teamLines.push({
        matchId, clubId, opponentId: s === 0 ? awayId : homeId, goals,
        shots: { action: [0, 0], center: [0, 0], extra: [0, 0], sixMeter: [0, 0], penalty: [0, 0], counter: [0, 0], total: [goals, goals] },
        assists: 0, turnovers: 0, steals: 0, blocks: 0, exclusionsCommitted: lines.reduce((n, l) => n + l.exclusionsField, 0), penaltyFouls: 0, saves: 0,
      });
    });
  }

  const players = buildPlayers(appearances);
  return {
    source: 'Aquatic Sports Association of Malta (asaofmalta.eu, SportsPress events and match cards)',
    season: ASA_SEASONS[0].label,
    fetchedAt: new Date().toISOString(),
    competitions: [...usedCompetitions.values()],
    clubs: [...clubs.values()],
    players,
    matches,
    playerLines,
    goalkeeperLines: [] as GoalkeeperMatchLine[],
    teamLines,
  };
}

/**
 * Cards carry no player ids, so a player is their normalized full name:
 * - "M BONELLO DUPUIS" (initial only) joins the one full-name player of the same club with that surname and initial;
 * - spelling variants in one club ("Aiden"/"Aidan", "Steve"/"Stevie") are one person if they never share a card;
 * - the same name at two clubs in one season is treated as two people (id suffixed with the club);
 *   across seasons it is one person who moved, and their club is the latest one.
 * Goalkeepers are not marked on the cards: by the caps rule, 1 and 13 are the goalkeepers' caps, so a player who
 * mostly wears 1, or 13 with almost no goals or exclusions (13 is sometimes a field player in smaller squads), is a GK.
 */
function buildPlayers(apps: { line: PlayerMatchLine; firstName: string; lastName: string; date: string; season: number }[]): RealPlayer[] {
  const key = (a: { firstName: string; lastName: string }) => nameKey(`${a.firstName} ${a.lastName}`);
  // Initials → full name within a club.
  for (const a of apps) {
    if (nameKey(a.firstName).length !== 1) continue;
    const full = new Set(
      apps
        .filter((b) => b.line.clubId === a.line.clubId && nameKey(b.lastName) === nameKey(a.lastName) && nameKey(b.firstName).length > 1 && nameKey(b.firstName)[0] === nameKey(a.firstName))
        .map((b) => `${b.firstName}\u0000${b.lastName}`),
    );
    if (full.size === 1) [a.firstName, a.lastName] = [...full][0].split('\u0000');
  }
  // Spelling variants of a first name within a club: the most used spelling wins.
  type Variant = { firstName: string; lastName: string; count: number; matches: Set<string> };
  const byClubSurname = new Map<string, Map<string, Variant>>();
  for (const a of apps) {
    const k = `${a.line.clubId}|${nameKey(a.lastName)}`;
    const variants = byClubSurname.get(k) ?? new Map<string, Variant>();
    const v = variants.get(nameKey(a.firstName)) ?? { firstName: a.firstName, lastName: a.lastName, count: 0, matches: new Set<string>() };
    v.count++;
    v.matches.add(a.line.matchId);
    variants.set(nameKey(a.firstName), v);
    byClubSurname.set(k, variants);
  }
  const rename = new Map<string, Variant>(); // club|surname|first → canonical spelling
  for (const [k, variants] of byClubSurname) {
    const ranked = [...variants.entries()].sort((a, b) => b[1].count - a[1].count);
    const kept: [string, Variant][] = [];
    for (const [first, v] of ranked) {
      const into = kept.find(([f, c]) => similarFirstNames(f, first) && ![...v.matches].some((m) => c.matches.has(m)));
      if (!into) {
        kept.push([first, v]);
        continue;
      }
      for (const m of v.matches) into[1].matches.add(m);
      rename.set(`${k}|${first}`, into[1]);
    }
  }
  for (const a of apps) {
    const c = rename.get(`${a.line.clubId}|${nameKey(a.lastName)}|${nameKey(a.firstName)}`);
    if (c) [a.firstName, a.lastName] = [c.firstName, c.lastName];
  }
  // Same name at two clubs in the same season → separate people.
  const clubsBySeason = new Map<string, Set<string>>();
  for (const a of apps) {
    const k = `${key(a)}|${a.season}`;
    clubsBySeason.set(k, (clubsBySeason.get(k) ?? new Set()).add(a.line.clubId));
  }
  const groups = new Map<string, typeof apps>();
  for (const a of apps) {
    const clash = (clubsBySeason.get(`${key(a)}|${a.season}`)?.size ?? 0) > 1;
    const id = `MLT-P-${slug(`${a.firstName} ${a.lastName}`)}${clash ? `-${slug(a.line.clubId.slice(4))}` : ''}`;
    a.line.playerId = id;
    groups.set(id, [...(groups.get(id) ?? []), a]);
  }

  const players: RealPlayer[] = [];
  for (const [id, list] of groups) {
    const latest = list.reduce((x, y) => (y.date >= x.date ? y : x));
    const nameCounts = new Map<string, number>();
    const capCounts = new Map<number, number>();
    for (const a of list) {
      nameCounts.set(`${a.firstName}\u0000${a.lastName}`, (nameCounts.get(`${a.firstName}\u0000${a.lastName}`) ?? 0) + 1);
      capCounts.set(a.line.cap, (capCounts.get(a.line.cap) ?? 0) + 1);
    }
    const [firstName, lastName] = [...nameCounts].sort((a, b) => b[1] - a[1])[0][0].split('\u0000');
    const cap = [...capCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const activity = list.reduce((n, a) => n + a.line.shots.total[0] + a.line.exclusionsField, 0) / list.length;
    const goalkeeper = cap === 1 || (cap === 13 && activity < 0.25);
    players.push({
      id, firstName, lastName, clubId: latest.line.clubId, cap,
      position: goalkeeper ? 'GK' : 'DRIVER',
      positionSource: goalkeeper ? 'inferred' : 'default',
    });
  }
  return players;
}

/** "AIDEN"/"AIDAN", "ZAK"/"ZAC", "STEVE"/"STEVIE": one letter apart (two for longer names), or one starts the other. */
function similarFirstNames(a: string, b: string) {
  if (a.length < 3 || b.length < 3) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length] <= (Math.min(a.length, b.length) >= 5 ? 2 : 1);
}
