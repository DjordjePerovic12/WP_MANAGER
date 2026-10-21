import { describe, expect, it } from 'vitest';
import { generateLeague, LiveMatch, simulateMatch, TUNING, type MatchResult } from '../engine';

const [home, away] = generateLeague(21);

describe('live match', () => {
  it('stepping to the end gives exactly the same match as simulateMatch', () => {
    const live = new LiveMatch([home, away], { seed: 77 });
    const events = [];
    while (!live.finished) events.push(...live.step());
    const all = simulateMatch(home, away, { seed: 77 });
    expect(events).toEqual(all.events);
    expect(live.result()).toEqual(all);
  });

  it('applies a tactics change from the next possession and reports it', () => {
    const live = new LiveMatch([home, away], { seed: 3, managed: [true, false] });
    live.step();
    live.setTactics(0, { defense: 'zone' });
    expect(live.state().teams[0].tactics.defense).toBe('zone');
    const fresh = live.step();
    expect(fresh[0]).toMatchObject({ type: 'tactics', team: 0, tactics: { defense: 'zone' } });
  });

  it('takes a requested timeout when the team has the ball, and only two per match', () => {
    const live = new LiveMatch([home, away], { seed: 5, managed: [true, false] });
    live.step();
    expect(live.callTimeout(0)).toBe(true);
    let taken = 0;
    for (let i = 0; i < 6 && !live.finished; i++) taken += live.step().filter((e) => e.type === 'timeout' && e.team === 0).length;
    expect(taken).toBe(1);
    expect(live.state().teams[0].timeouts).toBe(TUNING.timeouts - 1);
    live.callTimeout(0);
    while (live.state().teams[0].pendingTimeout) live.step();
    expect(live.callTimeout(0)).toBe(false);
  });

  it('a managed team takes no automatic timeouts or tactic changes', () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = simulateMatch(home, away, { seed, managed: [true, false] });
      expect(r.events.some((e) => e.team === 0 && (e.type === 'timeout' || e.type === 'tactics'))).toBe(false);
    }
  });

  it('substitutes on request and rejects illegal substitutions', () => {
    const live = new LiveMatch([home, away], { seed: 9, managed: [true, false], autoSubs: false });
    live.step();
    const s = live.state().teams[0];
    const out = s.water[3];
    const incoming = s.bench.find((id) => home.players.find((p) => p.id === id)!.position !== 'GK')!;
    expect(live.substitute(0, out, incoming)).toBeNull();
    expect(live.state().teams[0].water).toContain(incoming);
    expect(live.state().teams[0].bench).toContain(out);
    const gkOnBench = live.state().teams[0].bench.find((id) => home.players.find((p) => p.id === id)!.position === 'GK')!;
    expect(live.substitute(0, live.state().teams[0].water[2], gkOnBench)).toMatch(/goalkeeper/i);
    expect(live.substitute(0, 'nobody', incoming)).toMatch(/not in the water/);
  });

  it('without auto subs, a managed team only changes players when told to (or when forced)', () => {
    const r = simulateMatch(home, away, { seed: 11, managed: [true, false], autoSubs: false });
    const subs = r.events.filter((e) => e.type === 'sub' && e.team === 0);
    const forced = new Set(r.events.filter((e) => (e.type === 'fouled_out' && e.team === 0) || (e.type === 'brutality' && e.team === 1)).map((e) => e.type === 'brutality' ? e.other : e.player));
    for (const e of subs) expect(forced.has(e.other)).toBe(true);
  });

  it('records energy snapshots that fall during the match and stay within 0–100', () => {
    const r = simulateMatch(home, away, { seed: 4 });
    expect(r.energy!.length).toBeGreaterThan(40);
    for (const snap of r.energy!) {
      expect(snap.eventIndex).toBeLessThanOrEqual(r.events.length);
      for (const v of Object.values(snap.energy)) expect(v >= 0 && v <= 100).toBe(true);
    }
  });
});

describe('brutality', () => {
  const matches: MatchResult[] = Array.from({ length: 400 }, (_, i) => simulateMatch(home, away, { seed: i }));
  const cases = matches.flatMap((m) => m.events.map((e, i) => ({ m, e, i })).filter(({ e }) => e.type === 'brutality'));

  it('happens rarely, about once every 10–15 matches', () => {
    expect(cases.length / matches.length).toBeGreaterThan(0.04);
    expect(cases.length / matches.length).toBeLessThan(0.15);
  });

  it('gives a penalty, sends the player off for good, and the team plays a man down for 4 minutes', () => {
    for (const { m, e, i } of cases) {
      const next = m.events.slice(i + 1);
      expect(next.find((x) => x.situation === 'penalty' && ['goal', 'save', 'miss'].includes(x.type))?.team).toBe(e.team);
      for (const x of next) for (const id of [x.player, x.assist]) if (id && x.type !== 'sub') expect(id).not.toBe(e.other);
      // The replacement comes in no sooner than 4 minutes of game time later.
      const elapsed = (x: typeof e) => (Math.min(x.quarter, 4) - 1) * TUNING.quarterSeconds + (TUNING.quarterSeconds - x.clock);
      const sub = next.find((x) => x.type === 'sub' && x.other === e.other);
      if (sub) expect(elapsed(sub) - elapsed(e)).toBeGreaterThanOrEqual(TUNING.brutalitySeconds - 1);
    }
  });
});
