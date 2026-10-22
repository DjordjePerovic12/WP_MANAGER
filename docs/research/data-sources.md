# Where to get more real data (research, 21 October 2026)

What we use now: European Aquatics pages (clubs in the European cups) and World Aquatics (heights, birth dates). This file covers the domestic leagues.

**The old Regional League A1/A2 no longer runs.** Its successors are the **VRL** (Serbia and Montenegro) and **Croatia's national league**.

**One rule for every source below:** read public pages only. Where a page loads its data through a token-protected API, record what the page itself loads in a headless browser, the same way `data/sources/europeanaquatics.ts` does. Never call those APIs directly.

## Best sources, in order

### 1. Croatia: hvs.hr (Croatian federation)
- **Coverage:** the Croatian league, lower divisions and the cup. It also has archives of the old Regional League (Premier /natjecanje/410, A1 /natjecanje/414) back to 2014-15.
- **URL patterns:** `https://hvs.hr/natjecanje/{id}` (522 = senior men's league), `/utakmica/{id}`, `/igrac/{id}`, `/klub/{id}`.
- **Fields:**
  - Per match: caps, names, goals and attempts, exclusions, quarter scores, play-by-play, goalkeeper stats.
  - Per player: birth date, nationality, club. No height or hand.
- **Format:** a JavaScript app that loads its data through a token-protected API. Use headless capture.
- **robots.txt:** allows everything. **Data is current:** 2026-27 rounds 1–7 have full stats.

### 2. Hungary: ivr.waterpolo.hu/api/public/ (MVLSZ)
- **Format:** public JSON, no login.
  - `players?page=N`: 43,730 players
  - `competitions`, `seasons` (from 1972), `clubs`, `leagues`
  - `games?page=N`, `games/{id}`
- **Player fields:** name, birth date, **height, weight, dominant hand, position**, club.
- **Gaps:** no per-game box scores found.
- **Care needed:**
  - The main site, www.waterpolo.hu, disallows crawling its match and player pages. Keep this API low-rate.
  - Player records also hold administrative data: registration numbers, medical dates. **Store only the game fields.**

### 3. Total Waterpolo / twstatistics.com
- **Coverage:** the official host of the VRL, Premier and First League. Also the Montenegrin league and cup, Hungary, Slovenia, Austria, the Alpe Adria league, the Nordic leagues, France and others.
- **Static JSON:**
  - `https://twstatistics.com/assets/data/players-mininfo.json`: 17,451 players with height, weight, **dominant hand** and position.
  - `teams-mininfo.json`: 1,558 teams.
- **Matches and rosters:** loaded through a token-protected proxy. Headless capture only.
- **Ownership:** the data is theirs, from their Arena app. **Best single source for Serbia and Montenegro: worth emailing them for permission.**

### 4. Malta: asaofmalta.eu
- **Public JSON:** `https://asaofmalta.eu/wp-json/sportspress/v2/events?per_page=100&page=N` has 2,150 matches with teams and quarter scores.
- **Match cards:** each match page (`/event/{id}/`) links a match-card PDF. The PDFs are machine-generated, so `pdftotext -layout` reads them cleanly: caps, names, goals, exclusions, play-by-play.
- **Season pages:** HTML tables from 2020 onward.
- **robots.txt:** only blocks `/wp-admin/`.

### 5. Greece: waterpololeague.gr
- **Pages:** `/championship/wpl-26-27/{fixtures|standings|teams}`, in plain HTML that's easy to parse.
- **Coverage:** results and tables only. No rosters or box scores.

## Weaker or blocked

| Country | Source | Status |
|---|---|---|
| Serbia | waterpoloserbia.org | Match reports and fixture PDFs only. It links to Total Waterpolo for stats. |
| Italy | federnuoto.it | Bot protection, not bypassed. Italian Wikipedia has results and tables via the MediaWiki API, but squads are rare. |
| Spain | rfen.es | Didn't connect from here. Regulations and match-sheet PDFs are at cdn.rfen.es. |
| Germany | dsvdaten.dsv.de | robots.txt says `Disallow: /`, so skipped. |
| France | ffnatation (extranat) | Down for maintenance. |
| Montenegro, Slovenia, Bosnia | Federation sites | Didn't connect. Total Waterpolo covers Montenegro and Slovenia. |

**Timing providers:** Microplus only serves the European competitions. Sportradar is paid.
