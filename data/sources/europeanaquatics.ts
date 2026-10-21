// European Aquatics club competitions (Champions League, Euro Cup, Conference Cup…).
//
// The public results pages at championsleague.europeanaquatics.org are a
// browser app (by Microplus). We load those pages in a headless browser, like a
// normal visitor, and record the data the page itself receives. We never call
// their data API directly. Pages are visited slowly, and finished matches are
// cached forever, so each one is only loaded once.

import { chromium, type Page } from 'playwright';
import { readCache, sleep, writeCache } from '../http';

export const EA_SEASON = { code: 'EACLUB27', label: '2026-27' };
const RESULTS_PAGE = 'https://championsleague.europeanaquatics.org/results/';
const PAGE_DELAY_MS = 3000;
const NS = 'europeanaquatics';

// ---- Raw shapes (only the fields we use) ----

export interface EaEvent { GaraCatCode: string; GaraCode: string; GaraDescrEng: string; CatSex: string }
export interface EaTeam { TeamCatCode: string; TeamCode: string; TeamName: string; TeamNameTV: string; TeamNaz: string }
export interface EaRosterPlayer {
  PlaCatCode: string; PlaGaraCode: string; PlaTeamCode: string; PlaCode: string; PlaNumber: number;
  PlaSurname: string; PlaName: string; PlaHeight: number | null; PlaBirth: string | null; PlaNaz: string | null;
  PlaRoleEng: string | null; Staff: number;
}
export interface EaScheduleMatch {
  OraCatCode: string; OraGaraCode: string; OraTurCode: string; OraGruCode: number;
  OraTeamCodeA: string; OraTeamCodeB: string; OraResA: number | null; OraResB: number | null;
  OraStatus: number; OraCodPub: string; OraMatchDate: string; OraVenue: string; OraMatchDescrEng: string;
}
export type EaStatRow = Record<string, string | number | null> & { StaTeamCode: string; StaPlaCode?: string; StaPlaNumber: number | null };
export interface EaMatchData {
  results: { Results: { ResTeamA: number; ResTeamB: number; Periods: { PerNumber: number; PerResA: number; PerResB: number }[] }[] };
  startlist: { Startlist: { ForTeamCode: string; ForPlaCode: string; ForPlaNumber: number; ForPlaRoleCode: string | null }[] };
  fullstatistics: { FullStatistics: EaStatRow[]; Goalkeepers: EaStatRow[] };
}

export interface EaSeason {
  events: EaEvent[];
  teams: EaTeam[];
  rosters: EaRosterPlayer[];
  schedule: EaScheduleMatch[];
  matches: Record<string, EaMatchData>;
}

export const matchKey = (m: EaScheduleMatch) =>
  [m.OraCatCode, m.OraGaraCode, m.OraTurCode, m.OraGruCode, m.OraTeamCodeA, m.OraTeamCodeB].join('/');

/** Visit a page and collect the named data responses it loads (e.g. "teams", "schedule"). */
async function capture(page: Page, route: string, wanted: string[], timeoutMs = 30000): Promise<Record<string, any>> {
  const got: Record<string, any> = {};
  const onResponse = async (res: import('playwright').Response) => {
    const url = res.url();
    const marker = `/${EA_SEASON.code}/get/`;
    if (!url.includes(marker) || !res.ok()) return;
    const name = url.split(marker)[1].split('/')[0];
    // Prefer the "all" variant (…/teams/*) over category-specific ones.
    if (!wanted.includes(name) || (got[name] && !url.endsWith('*'))) return;
    try {
      got[name] = await res.json();
    } catch {
      /* response body unavailable (e.g. page navigated away) */
    }
  };
  page.on('response', onResponse);
  await page.goto('about:blank');
  await page.goto(RESULTS_PAGE + route, { waitUntil: 'domcontentloaded' });
  const start = Date.now();
  while (wanted.some((w) => !got[w]) && Date.now() - start < timeoutMs) await sleep(250);
  page.off('response', onResponse);
  const missing = wanted.filter((w) => !got[w]);
  if (missing.length) throw new Error(`${route}: did not receive ${missing.join(', ')}`);
  return got;
}

export async function fetchEuropeanAquatics(options: { maxNewMatches?: number; log?: (s: string) => void } = {}): Promise<EaSeason> {
  const log = options.log ?? console.log;
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: `Mozilla/5.0 (compatible; WaterPoloManagerHobby/0.1; non-commercial)` });
  try {
    // Season-wide data changes during the season, so it is refreshed on every run.
    log('European Aquatics: rosters…');
    const rosterPage = await capture(page, '#/team-rosters', ['events', 'teams', 'teamroster']);
    await sleep(PAGE_DELAY_MS);
    log('European Aquatics: schedule…');
    const calendarPage = await capture(page, '#/calendar', ['schedule']);
    const season: EaSeason = {
      events: rosterPage.events.Events,
      teams: rosterPage.teams.Teams,
      rosters: rosterPage.teamroster.Players,
      schedule: calendarPage.schedule.Schedule,
      matches: {},
    };
    writeCache(NS, `${EA_SEASON.code}/season`, { ...season, matches: undefined });

    // Finished men's matches. Results never change once final, so they are cached for good.
    const finished = season.schedule.filter((m) => m.OraCatCode === 'ASM' && m.OraStatus === 2);
    let fetched = 0;
    for (const m of finished) {
      const key = matchKey(m);
      const cached = readCache<EaMatchData>(NS, `${EA_SEASON.code}/match/${key}`);
      if (cached) {
        season.matches[key] = cached;
        continue;
      }
      if (options.maxNewMatches !== undefined && fetched >= options.maxNewMatches) continue;
      await sleep(PAGE_DELAY_MS);
      log(`European Aquatics: match ${m.OraMatchDate} ${m.OraTeamCodeA}–${m.OraTeamCodeB}`);
      try {
        const data = (await capture(page, `#/match-details/results/${key}/${m.OraCodPub}`, ['results', 'startlist', 'fullstatistics'])) as EaMatchData;
        writeCache(NS, `${EA_SEASON.code}/match/${key}`, data);
        season.matches[key] = data;
        fetched++;
      } catch (e) {
        log(`  skipped: ${(e as Error).message}`);
      }
    }
    log(`European Aquatics: ${Object.keys(season.matches).length}/${finished.length} finished men's matches (${fetched} new)`);
    return season;
  } finally {
    await browser.close();
  }
}

/** Load the last fetched season from the cache without touching the network. */
export function loadCachedEuropeanAquatics(): EaSeason | undefined {
  const season = readCache<Omit<EaSeason, 'matches'>>(NS, `${EA_SEASON.code}/season`);
  if (!season) return undefined;
  const matches: Record<string, EaMatchData> = {};
  for (const m of season.schedule.filter((x) => x.OraCatCode === 'ASM' && x.OraStatus === 2)) {
    const data = readCache<EaMatchData>(NS, `${EA_SEASON.code}/match/${matchKey(m)}`);
    if (data) matches[matchKey(m)] = data;
  }
  return { ...season, matches };
}
