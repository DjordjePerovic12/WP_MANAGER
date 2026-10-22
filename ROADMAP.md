# Roadmap: from a league game to a full manager game

Each step works the same way:
- It ships on its own and can be played.
- It has tests, and existing saves keep working (save migration).
- It is clicked through in the browser before it counts as done.
- It is committed only after you've tried it.

## Block A: the season builds to a climax (competitions)

### A1. Calendar (foundation): ✅ built 2026-10-21, not committed
Size: M, with little visible change.
- Replace league "rounds" with a **calendar of weeks**. A week can hold matches from several competitions, or none.
- Every fixture knows its competition and stage, for example *Adriatic League, round 7* or *Cup, semi-final, leg 1*.
- Training, finances, injuries, scouting and the January window move from "per round" to "per week".
- Fixtures screen: a calendar view of the season.
- **Saves:** an existing career finishes its current season as it is, and moves to the new calendar from next season.

### A2. Playoffs and the domestic cup: ✅ built 2026-10-21, not committed
Size: L.
- **Playoffs.** After the regular season, the top clubs play a knockout bracket, and the playoff winner is the champion. The format can be set per league: how many clubs qualify, and best-of-1, 2 or 3 per round.
- **Domestic cup.** A knockout competition for all clubs, through to a final.
- **Knockout matches** can't end level: a draw goes to a penalty shootout. The engine already supports shootouts.
- **Season targets.** Board targets and prize money count playoffs and the cup, e.g. "reach the semi-final".
- **Trophy cabinet** for the club.
- **Season review:** a bracket view.

### A3. European competitions: ✅ built 2026-10-22, not committed
Size: L.
- **Competitions:** Champions League, Euro Cup and Conference Cup. Each has a group stage, knockout rounds and a **Final Four** weekend.
- **Qualification:** league finish decides who goes, with a set number of places for each league.
- **Foreign clubs** are the real European clubs we already have. They are kept up to date each summer: aging, development and youth intake, but simpler than your league.
- **More matches per season.** Rotation and squad depth now matter, because players are playing twice a week.
- **Rewards:** European prize money and prestige.

## Block B: players as people

### B1. Individual happiness: ✅ in main 2026-10-22
Size: M.
- **Squad status** for each player, agreed in his contract: key player, regular, rotation, backup or youth.
- **Happiness** depends on minutes compared with his status, his contract, results and his personality.
- **Effects:**
  - his form on match day
  - how willing he is to renew
  - transfer requests
  - how the reports judge him
- **Dressing room atmosphere:** the team's mood is built from individual players' moods.

### B2. Inbox and conversations: ✅ built 2026-10-22 on feature/b2-inbox
Size: L.
- **Inbox** replaces the news feed. Items that need a decision wait there: player chats, board requests, offers.
- **Player conversations** with choices, for example:
  - "I want more minutes" → promise minutes, or tell him to earn it
  - "I want a new contract"
  - "A big club wants me"
- **Promises are tracked.** Broken promises cost trust and happiness, and he may ask to leave.
- **Captain and team leaders.** Their mood spreads through the squad.

## Block C: match day

### C1. Player ratings: ✅ built 2026-10-22, not committed
Size: S.
- Every player gets a rating out of 10 after each match, built from match events, plus a man of the match.
- Ratings appear in the match screen, in Stats (average rating), in the profile and in the reports.

### C2. Opposition report and instructions
Size: L. Needs engine changes, checked against the real-world stats calibration.
- **Pre-match report** on the opponent: their danger man, their 6-on-5 shooters, how they defend, recent form.
- **Instructions:**
  - tight-mark one player
  - double-team their center
  - choose who takes penalties
  - choose your 6-on-5 shooters
  - name the captain

### C3. Team talks
Size: S.
- Before the match and at half-time, pick a tone: calm, demanding, praise or no pressure.
- Players react differently depending on their personality and the score.

## Block D: your career as a manager

### D1. Reputation, sacking and job offers
Size: M. Needs A3 (foreign clubs).
- **Manager reputation** grows with results and trophies.
- **The board can sack you** after a bad run.
- **Job offers** come from other clubs and leagues. You can accept and take over a new squad while the save continues.

### D2. National team
Size: L. Uses World Aquatics data.
- **Getting the job:** coach a national team alongside your club job, or instead of it.
- **Tournaments:** European Championships, World Championships and the Olympics in the summer.
- **Selecting players:** call-ups from all clubs. A summer tournament affects players' fitness for the next season.

## Block E: a bigger world

| Step | What | Size | Needs |
|---|---|---|---|
| E1 | Transfers between leagues (foreign clubs on the market) | M | A3 |
| E2 | Loans, especially for young players | M | |
| E3 | Hall of fame, club records, achievements | S | |
| E4 | Difficulty settings, youth academy preview | S | |

## Order

**A1 → A2 → C1 → A3 → B1 → B2 → C2 → C3 → D1 → D2 → E**

- **A1** first, because everything that adds matches needs the calendar.
- **C1** (ratings) is small, and it improves the reports, the stats and B1. It goes in early as a quick win between two big steps.
- **D1** and **E1** need the foreign clubs from **A3**.

## Decided 2026-10-21 (from the research in docs/research/)
- **Leagues:** the real 2026-27 structure. The VRL (Serbia and Montenegro, Final Four) and the Croatian league (top 8, best-of-3/3/5) replace the suspended Adriatic League. Older Adriatic saves move over at their next summer.
- **No draws in league games:** penalties, scored 3/2/1/0.
- **Scrapers:** Croatia (hvs.hr), Hungary (MVLSZ public API) and Malta (ASA). Total Waterpolo will be discussed at the end.
- **Follow-up:** scoring in domestic leagues is high, about 15 goals per team per game against about 12–13 in real play. Generated clubs can produce unrealistic stars (one scored 123 goals in a season). Recalibrate.

## Questions for you (the water polo expert)

1. **Playoffs per league.** How many clubs qualify, and best-of how many in each round, for:
   - the Adriatic League
   - Italy
   - Spain
   - Greece
   - Germany
   - Hungary

   And does the regular season winner get anything?
2. **Domestic cups.** Which leagues have one, and what format do they use (Final Four, single matches, two legs)?
3. **European places.** How many clubs from each league go to the Champions League, the Euro Cup and the Conference Cup? And is there a qualification round?
4. **Champions League format.** Our data is from 2026-27: how many groups and clubs, and does it end in a Final Four or a Final Eight?

I'll use realistic defaults where you don't know or don't care. Every format will be a setting that's easy to change.
