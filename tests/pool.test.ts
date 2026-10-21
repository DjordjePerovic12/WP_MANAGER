import { describe, expect, it } from 'vitest';
import { generateLeague, simulateMatch } from '../engine';
import { attacksRightIn, buildScenes, LENGTH, WIDTH } from '../web/src/pool/scene';

const [home, away] = generateLeague(11);
const matches = Array.from({ length: 20 }, (_, i) => simulateMatch(home, away, { seed: i + 1, shootoutOnDraw: true }));

describe('pool scenes', () => {
  it('has one scene per event, with 14 players inside the pool', () => {
    for (const m of matches) {
      const scenes = buildScenes(m);
      expect(scenes).toHaveLength(m.events.length);
      for (const s of scenes) {
        expect(s.dots.length).toBeGreaterThanOrEqual(12); // fewer only while a player is sent off
        expect(s.dots.length).toBeLessThanOrEqual(14);
        for (const d of s.dots) {
          expect(d.x).toBeGreaterThanOrEqual(0);
          expect(d.x).toBeLessThanOrEqual(LENGTH);
          expect(d.y).toBeGreaterThanOrEqual(0);
          expect(d.y).toBeLessThanOrEqual(WIDTH);
        }
      }
    }
  });

  it('puts the attacking team in the half it attacks, and switches ends at half time', () => {
    for (const m of matches) {
      const scenes = buildScenes(m);
      m.events.forEach((e, i) => {
        if (!['goal', 'save', 'exclusion', 'turnover'].includes(e.type) || e.quarter > 4 || e.situation === 'penalty') return;
        const attackers = scenes[i].dots.filter((d) => d.team === e.team && !d.goalkeeper);
        const avgX = attackers.reduce((s, d) => s + d.x, 0) / attackers.length;
        if (e.team === attacksRightIn(e.quarter)) expect(avgX).toBeGreaterThan(LENGTH / 2);
        else expect(avgX).toBeLessThan(LENGTH / 2);
      });
    }
    expect(attacksRightIn(1)).toBe(0);
    expect(attacksRightIn(3)).toBe(1);
  });

  it('starts each quarter with both teams on their own goal lines', () => {
    const m = matches[0];
    const scenes = buildScenes(m);
    m.events.forEach((e, i) => {
      if (e.type !== 'quarter_start') return;
      const right = attacksRightIn(e.quarter);
      for (const d of scenes[i].dots) {
        if (d.team === right) expect(d.x).toBeLessThan(2);
        else expect(d.x).toBeGreaterThan(LENGTH - 2);
      }
    });
  });

  it('sends the excluded player to the re-entry corner during the 6 on 5', () => {
    const m = matches.find((x) => x.events.some((e) => e.type === 'exclusion'))!;
    const scenes = buildScenes(m);
    const i = m.events.findIndex((e) => e.type === 'exclusion');
    const dot = scenes[i].dots.find((d) => d.id === m.events[i].other)!;
    expect(dot.excluded).toBe(true);
    expect(dot.y).toBeGreaterThan(WIDTH - 1.5);
  });
});

describe('match timeline', () => {
  it('keeps clocks, fouls and the ball route consistent', async () => {
    const { buildTimeline, EXCLUSION_SECONDS, SHOT_CLOCK } = await import('../web/src/pool/timeline');
    for (const m of matches) {
      const moments = buildTimeline(m);
      expect(moments).toHaveLength(m.events.length);
      moments.forEach((mo, i) => {
        if (mo.shotClock !== undefined) expect(mo.shotClock >= 0 && mo.shotClock <= SHOT_CLOCK).toBe(true);
        if (mo.exclusion) expect(mo.exclusion.remaining >= 0 && mo.exclusion.remaining <= EXCLUSION_SECONDS).toBe(true);
        for (const f of Object.values(mo.fouls)) expect(f).toBeLessThanOrEqual(3);
        const last = mo.ballPath.at(-1)!;
        expect([last.x, last.y]).toEqual([mo.ball.x, mo.ball.y]);
        const e = m.events[i];
        if (e.type === 'goal' && e.situation !== 'shootout') {
          expect(mo.banner?.kind).toBe('goal');
          expect(mo.goalSide).toBeDefined();
          expect(mo.shot?.outcome).toBe('goal');
        }
        if (e.type === 'exclusion') expect(mo.exclusion?.playerId).toBe(e.other);
      });
    }
  });

  it('counts live player stats up to the current moment', async () => {
    const { liveStats } = await import('../web/src/pool/timeline');
    const m = matches[0];
    const goal = m.events.findIndex((e) => e.type === 'goal' && e.situation !== 'shootout');
    const scorer = m.events[goal].player!;
    expect(liveStats(m, scorer, goal).goals).toBeGreaterThanOrEqual(1);
    expect(liveStats(m, scorer, goal - 1).goals).toBe(liveStats(m, scorer, goal).goals - 1);
  });
});
