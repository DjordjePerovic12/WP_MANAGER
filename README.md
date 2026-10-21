# Water Polo Manager

A Football Manager-style water polo game. Currently: a match engine, real European club data, and a local API.

## Run it
- `npm install`: once
- `npm run server`: local API at http://localhost:8787/api (real clubs from the database)
- `npm run dev`: web page at http://localhost:5173 (uses real clubs when the API is running, fictional ones otherwise)
- `npm test`: all tests

## Playing a match (web page)
- Pick two clubs and their tactics, choose a speed (Normal, Fast, Highlights or Instant), and press Play.
- **You manage**: pick Home or Away to coach that team live. Pause any time, call timeouts (taken when your team has the ball), change defense, 6 on 5 setup, counterattack and fronting, and make substitutions (tap the player coming off, then the one going on). Leave "Assistant handles rotation" on to keep automatic rolling subs.
- The pool view shows every player as a cap with energy bar and foul dots; tap a cap for live stats and attributes. Goals, exclusions (with the 18-second countdown), penalties, brutality, timeouts and quarter changes get banners, and the ball follows the passes to the shot.
- **Seed**: leave empty for a new match each time, or type a number to replay exactly the same match (to compare tactics, share a match, or report a bug).

## Real data
- `npm run data:fetch`: download the 2026-27 European cups (Champions League, Euro Cup, Conference Cup) from the public European Aquatics results pages, plus heights from the World Aquatics API. It's polite (one page every few seconds) and cached in `data/cache/`, so re-runs only fetch new matches. Run it weekly.
- `npm run data:build`: build the clean data set → `data/out/dataset.json`
- `npm run db:seed`: load it, with game ratings, into the local database (`local/waterpolo.db`)
- `npm run data:report`: real match statistics (the engine's calibration targets)
- `npm run ratings:report`: top-rated players per position. **Review this and correct mistakes in `data/overrides.json`.**
- `npm run data:replay`: replay every real match with real squads and compare with reality

Known gaps in the sources: positions are published only for goalkeepers (field positions are inferred from stats), handedness isn't published (guessed until set in overrides), and minutes played aren't available.

## Engine tools
- `npm run play -- 42`: one match in the terminal (fictional clubs; the same seed gives the same match)
- `npm run batch -- 3000`: thousands of matches, with realism statistics

## Where things are
- `engine/`: the match simulation (pure TypeScript, no dependencies). `LiveMatch` plays a match one possession at a time and takes manager commands; `simulateMatch` plays it to the end. Balance numbers are in `engine/tuning.ts`, calibrated to real 2026-27 European club matches.
- `data/`: scrapers (`sources/`), normalizing, ratings from real stats (`ratings.ts`), reports
- `server/`: Hono API and database (Drizzle; SQLite locally, ready to move to Postgres). `users`/`saves` tables are placeholders for accounts later.
- `web/`: the React page; `sim/`: command-line tools; `tests/`: Vitest tests
