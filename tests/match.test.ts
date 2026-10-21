import { describe, expect, it } from 'vitest';
import { boxScore, defaultRoles, generateLeague, pickLineup, simulateMatch, TUNING, type MatchResult, type Player, type Team } from '../engine';
import { runBatch } from '../sim/batch';

const league = generateLeague(7);
const play = (seed: number, shootoutOnDraw = false) => simulateMatch(league[0], league[1], { seed, shootoutOnDraw });

describe('determinism', () => {
  it('replays the same match from the same seed', () => {
    expect(play(123)).toEqual(play(123));
  });

  it('plays different matches from different seeds', () => {
    expect(play(1).events).not.toEqual(play(2).events);
  });
});

describe('rules invariants', () => {
  const matches: MatchResult[] = Array.from({ length: 200 }, (_, i) => play(i, true));

  it('keeps the clock inside the quarter and moving forward', () => {
    for (const m of matches) {
      let last = { quarter: 0, clock: Infinity };
      for (const e of m.events) {
        expect(e.clock).toBeGreaterThanOrEqual(0);
        expect(e.clock).toBeLessThanOrEqual(TUNING.quarterSeconds);
        if (e.quarter === last.quarter) expect(e.clock).toBeLessThanOrEqual(last.clock);
        else expect(e.quarter).toBeGreaterThan(last.quarter);
        last = e;
      }
    }
  });

  it('final score matches the goals scored and the quarter scores', () => {
    for (const m of matches) {
      const box = boxScore(m);
      expect([box.teams[0].goals, box.teams[1].goals]).toEqual(m.score);
      const sum = m.quarterScores.reduce((s, [a, b]) => [s[0] + a, s[1] + b], [0, 0]);
      expect(sum).toEqual(m.score);
    }
  });

  it('never gives a player more than 3 personal fouls, and a fouled-out player takes no further part', () => {
    for (const m of matches) {
      const box = boxScore(m);
      for (const s of Object.values(box.players)) expect(s.personalFouls).toBeLessThanOrEqual(TUNING.maxPersonalFouls);
      const out = new Set<string>();
      for (const e of m.events) {
        if (e.type === 'fouled_out') {
          out.add(e.player!);
          continue;
        }
        if (e.type === 'sub') {
          expect(out.has(e.player!)).toBe(false); // can't come back on
          continue;
        }
        for (const id of [e.player, e.other, e.assist]) if (id) expect(out.has(id)).toBe(false);
      }
    }
  });

  it('only lets players in the water take part', () => {
    for (const m of matches) {
      const box = boxScore(m);
      for (const s of Object.values(box.players)) {
        if (s.goals || s.shots || s.saves || s.personalFouls) expect(s.seconds).toBeGreaterThan(0);
      }
    }
  });

  it('every player in the water plays the full 32 minutes as a team: 7 × 32 minutes per side', () => {
    for (const m of matches) {
      for (const team of m.teams) {
        const total = team.players.reduce((s, p) => s + m.secondsPlayed[p.id], 0);
        expect(total).toBeCloseTo(7 * 4 * TUNING.quarterSeconds - 7 * 4 * 4, -2);
      }
    }
  });

  it('a shootout always produces a winner', () => {
    for (const m of matches) {
      if (m.score[0] !== m.score[1]) continue;
      expect(m.shootout).toBeDefined();
      expect(m.shootout![0]).not.toBe(m.shootout![1]);
    }
  });
});

describe('realism (batch statistics)', () => {
  const s = runBatch(600, 3);
  it.each([
    // Targets from real 2026-27 European club matches (npm run data:report), with tolerance.
    ['goals per team', s.goalsPerTeam, 12, 15.5],
    ['shooting %', s.shootingPct, 0.42, 0.56],
    ['exclusions per team', s.exclusionsPerTeam, 10.5, 14],
    ['6v5 goals per exclusion', s.powerPlayPct, 0.28, 0.38],
    ['penalties per game', s.penaltiesPerGame, 3, 4.5],
    ['fouled out per game', s.fouledOutPerGame, 1.5, 4.5],
    ['favourite win %', s.favouriteWinPct, 0.7, 0.92],
    ['draw %', s.drawPct, 0.065, 0.15],
    ['timeouts per team', s.timeoutsPerTeam, 0.9, 2],
    ['busiest field player minutes', s.busiestPlayerMinutes, 24, 30],
  ])('%s is realistic', (_label, value, min, max) => {
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });
});

// ------------------------------------------------------------- helpers

const clone = (t: Team): Team => structuredClone(t);
const withHands = (t: Team, hand: (p: Player) => Player['hand']): Team => {
  const c = clone(t);
  for (const p of c.players) p.hand = hand(p);
  return c;
};
const many = (home: Team, away: Team, n: number, from = 0, aiCoach: boolean | [boolean, boolean] = true) =>
  Array.from({ length: n }, (_, i) => simulateMatch(home, away, { seed: from + i, aiCoach }));

/** Replays sub events to know who is in the water when each event happens. */
function* withWater(m: MatchResult, team: 0 | 1) {
  const water = new Set(pickLineup(m.teams[team].players).water.map((p) => p.id));
  for (const e of m.events) {
    if (e.type === 'sub' && e.team === team) {
      water.delete(e.other!);
      water.add(e.player!);
    }
    // Fouled-out and sent-off players stay in the pool list until replaced, but cannot play.
    if (e.type === 'fouled_out' && e.team === team) water.delete(e.player!);
    if (e.type === 'brutality' && e.team !== team) water.delete(e.other!);
    if (e.type === 'injury' && e.team === team) water.delete(e.player!);
    yield { e, water };
  }
}

describe('left-handers on the right side', () => {
  it('the coach picks a lefty for a right-side slot over a slightly better right-hander', () => {
    const team = clone(league[2]);
    const wings = team.players.filter((p) => p.position === 'WING');
    wings[0].hand = 'R';
    wings[1].hand = 'L';
    wings[1].attrs = { ...wings[0].attrs, shootingAccuracy: wings[0].attrs.shootingAccuracy - 1 };
    const { water } = pickLineup(team.players);
    expect(water[5].id).toBe(wings[1].id); // water[5] is the right wing
    wings[1].hand = 'R';
    expect(pickLineup(team.players).water[5].id).toBe(wings[0].id);
  });

  it('a lefty on the right side raises power-play and even-strength scoring', () => {
    const rightSide = (t: Team) => new Set([3, 5].map((i) => pickLineup(t.players).water[i].id));
    const lefties = withHands(league[0], () => 'R');
    const ids = rightSide(lefties);
    for (const p of lefties.players) if (ids.has(p.id)) p.hand = 'L';
    const righties = withHands(league[0], () => 'R');
    const goals = (home: Team) => {
      const ms = many(home, league[1], 250, 5000);
      const box = ms.map(boxScore);
      const pp = box.reduce((s, b) => s + b.teams[0].powerPlayGoals, 0) / box.reduce((s, b) => s + b.teams[0].exclusionsDrawn, 0);
      return { pp, goals: box.reduce((s, b) => s + b.teams[0].goals, 0) / ms.length };
    };
    const l = goals(lefties);
    const r = goals(righties);
    expect(l.pp).toBeGreaterThan(r.pp + 0.02);
    expect(l.goals).toBeGreaterThan(r.goals + 0.3);
  });
});

describe('player roles', () => {
  it('suggests default 6v5 shooters and a penalty taker from the starting lineup', () => {
    const roles = defaultRoles(league[0].players);
    const starters = pickLineup(league[0].players).water.map((p) => p.id);
    expect(roles.powerPlayShooters).toHaveLength(TUNING.designatedShooters);
    for (const id of [...roles.powerPlayShooters, roles.penaltyTaker]) expect(starters).toContain(id);
  });

  it('the designated penalty taker takes every penalty while in the water', () => {
    const team = clone(league[0]);
    const starters = pickLineup(team.players).water;
    // Name the weakest-shooting starter, so automatic selection would never pick him.
    const taker = starters.slice(1).reduce((a, b) => (b.attrs.shootingAccuracy < a.attrs.shootingAccuracy ? b : a));
    team.tactics = { ...team.tactics, penaltyTaker: taker.id };
    let taken = 0;
    for (const m of many(team, league[1], 150)) {
      for (const { e, water } of withWater(m, 0)) {
        if (e.team !== 0 || e.situation !== 'penalty' || !['goal', 'save', 'miss'].includes(e.type)) continue;
        if (water.has(taker.id)) {
          expect(e.player).toBe(taker.id);
          taken++;
        }
      }
    }
    expect(taken).toBeGreaterThan(20);
  });

  it('designated 6v5 shooters get more of the power-play shots', () => {
    const team = clone(league[0]);
    const starters = pickLineup(team.players).water.slice(1);
    const named = [starters[1].id, starters[0].id]; // CDEF and CENTER: rarely the 6v5 shooters
    const share = (t: Team) => {
      let mine = 0;
      let all = 0;
      for (const m of many(t, league[1], 150)) {
        for (const e of m.events) {
          if (e.team !== 0 || e.situation !== 'powerplay' || e.type === 'turnover' || e.type === 'exclusion') continue;
          all++;
          if (named.includes(e.player!)) mine++;
        }
      }
      return mine / all;
    };
    const automatic = share(team);
    team.tactics = { ...team.tactics, powerPlayShooters: named };
    expect(share(team)).toBeGreaterThan(automatic * 1.4);
  });
});

describe('AI coach', () => {
  const zoneTeam = clone(league[0]);
  zoneTeam.tactics = { ...zoneTeam.tactics, defense: 'zone' };
  const ms = many(zoneTeam, league[3], 300);

  it('switches to a press only when trailing, and never mutates the team tactics', () => {
    const before = structuredClone(zoneTeam.tactics);
    const presses = ms.flatMap((m) => m.events.filter((e) => e.type === 'tactics' && e.team === 0 && e.tactics?.defense === 'press'));
    expect(presses.length).toBeGreaterThan(10);
    for (const e of presses) expect(e.score[0]).toBeLessThan(e.score[1]);
    expect(zoneTeam.tactics).toEqual(before);
  });

  it('a trailing coach pushes the counter, and switches tactics only when allowed', () => {
    const changes = ms.flatMap((m) => m.events.filter((e) => e.type === 'tactics'));
    const pushes = changes.filter((e) => (e.tactics?.counterAggression ?? 0) > 3);
    expect(pushes.length).toBeGreaterThan(10);
    for (const e of pushes) expect(e.score[e.team]).toBeLessThan(e.score[1 - e.team]);
    const manual = many(league[0], league[3], 50, 0, [false, true]);
    for (const m of manual) expect(m.events.some((e) => e.type === 'tactics' && e.team === 0)).toBe(false);
  });

  it('calls a timeout for a last-minute set play when level or one goal down', () => {
    let late = 0;
    let lateClose = 0;
    for (const m of ms) {
      for (const e of m.events) {
        if (e.type !== 'timeout' || e.quarter !== 4 || e.clock > 40) continue;
        late++;
        const diff = e.score[e.team] - e.score[1 - e.team];
        if (diff === 0 || diff === -1) lateClose++;
      }
    }
    expect(late).toBeGreaterThan(10);
    expect(lateClose / late).toBeGreaterThan(0.9);
  });

  it('rests a player on two fouls before the 4th quarter when the team is not behind', () => {
    let cases = 0;
    let benched = 0;
    for (const m of ms) {
      for (const team of [0, 1] as const) {
        const fouls = new Map<string, number>();
        const events = m.events;
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          if ((e.type !== 'exclusion' && e.type !== 'penalty_awarded') || e.team === team) continue;
          const n = (fouls.get(e.other!) ?? 0) + 1;
          fouls.set(e.other!, n);
          const lead = e.score[team] - e.score[1 - team];
          if (n !== 2 || e.quarter > 2 || lead < 0) continue;
          cases++;
          // Benched within the next few possessions?
          const soon = events.slice(i + 1, i + 25);
          if (soon.some((x) => x.type === 'sub' && x.team === team && x.other === e.other)) benched++;
        }
      }
    }
    expect(cases).toBeGreaterThan(20);
    expect(benched / cases).toBeGreaterThan(0.6);
  });
});

describe('rotation', () => {
  it('stars play most of the match and every field player gets in the water', () => {
    const ms = many(league[0], league[1], 100);
    const avgMinutes = (id: string) => ms.reduce((s, m) => s + m.secondsPlayed[id], 0) / ms.length / 60;
    const field = league[0].players.filter((p) => p.position !== 'GK');
    const minutes = field.map((p) => avgMinutes(p.id)).sort((a, b) => b - a);
    expect(minutes[0]).toBeGreaterThanOrEqual(24);
    expect(minutes[0]).toBeLessThanOrEqual(31);
    expect(minutes[minutes.length - 1]).toBeGreaterThan(2);
  });
});
