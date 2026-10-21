// Turns match events into readable play-by-play lines.

import type { MatchEvent, MatchResult, Player } from './types';

export function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function playerLookup(result: MatchResult) {
  const map = new Map<string, Player>();
  for (const t of result.teams) for (const p of t.players) map.set(p.id, p);
  return map;
}

export function describeEvent(e: MatchEvent, result: MatchResult, players = playerLookup(result)): string | null {
  const team = result.teams[e.team];
  const opp = result.teams[1 - e.team];
  const name = (id?: string) => {
    const p = id ? players.get(id) : undefined;
    return p ? `#${p.cap} ${p.name}` : '?';
  };
  const score = `${e.score[0]}–${e.score[1]}`;

  switch (e.type) {
    case 'quarter_start':
      return `— Quarter ${e.quarter} —`;
    case 'quarter_end':
      return `End of quarter ${e.quarter}. ${result.teams[0].short} ${score} ${result.teams[1].short}`;
    case 'full_time': {
      const so = result.shootout ? ` (${result.shootout[0]}–${result.shootout[1]} on penalties)` : '';
      return `FULL TIME: ${result.teams[0].name} ${score} ${result.teams[1].name}${so}`;
    }
    case 'sprint':
      return `${name(e.player)} wins the sprint against ${name(e.other)}. ${team.short} ball.`;
    case 'goal': {
      if (e.situation === 'shootout') return `Shootout: ${name(e.player)} (${team.short}) SCORES.`;
      const how = {
        even: '',
        powerplay: ' on the power play',
        counter: ' on the counterattack',
        penalty: ' from the 5m penalty',
        buzzer: ' at the buzzer!',
        shootout: '',
      }[e.situation ?? 'even'];
      const assist = e.assist ? ` Assist: ${name(e.assist)}.` : '';
      return `GOAL ${team.short}! ${name(e.player)} scores${how}.${assist} ${score}`;
    }
    case 'save':
      if (e.situation === 'shootout') return `Shootout: ${name(e.player)} (${team.short}) — saved by ${name(e.other)}.`;
      if (e.situation === 'penalty') return `${name(e.other)} saves the penalty from ${name(e.player)}!`;
      return `Save by ${name(e.other)} (${opp.short}) on ${name(e.player)}'s shot${e.situation === 'powerplay' ? ' — 6v5 wasted' : ''}.`;
    case 'miss':
      if (e.situation === 'shootout') return `Shootout: ${name(e.player)} (${team.short}) misses!`;
      if (e.situation === 'penalty') return `${name(e.player)} misses the penalty!`;
      return `${name(e.player)} (${team.short}) shoots wide.`;
    case 'block':
      return `${name(e.player)}'s shot is blocked by ${name(e.other)} (${opp.short}).`;
    case 'turnover':
      if (e.other) return `Steal! ${name(e.other)} (${opp.short}) takes the ball from ${name(e.player)}.`;
      if (e.situation === 'powerplay') return `Bad pass on the 6v5 from ${name(e.player)}. ${opp.short} ball.`;
      return `${team.short} lose the ball (${name(e.player)}).`;
    case 'offensive_foul':
      return `Offensive foul on the center ${name(e.player)} (${team.short}).`;
    case 'shot_clock':
      return `Shot clock violation, ${team.short}.`;
    case 'exclusion':
      return `Exclusion! ${name(e.other)} (${opp.short}) is sent out, drawn by ${name(e.player)}. 6 on 5 for ${team.short}.`;
    case 'penalty_awarded':
      return `PENALTY for ${team.short}! ${name(e.other)} fouls ${name(e.player)} inside 5m.`;
    case 'fouled_out':
      return `${name(e.player)} (${team.short}) has 3 personal fouls and is out of the game.`;
    case 'counter':
      return `${team.short} break on the counter, ${name(e.player)} leading.`;
    case 'timeout':
      return `Timeout ${team.name}.`;
    case 'brutality':
      return `BRUTALITY! ${name(e.other)} (${opp.short}) is sent off for the rest of the match after striking ${name(e.player)}. Penalty to ${team.short}, and ${opp.short} play a man down for 4 minutes.`;
    case 'sub':
      return null; // rolling substitutions are too frequent to narrate
    case 'tactics': {
      const changes: string[] = [];
      const defense = { press: 'a pressing defense', zone: 'a zone', mdrop: 'an M-drop' };
      if (e.tactics?.defense) changes.push(`switch to ${defense[e.tactics.defense]}`);
      const counter = e.tactics?.counterAggression;
      if (counter !== undefined) {
        changes.push(counter >= 4 ? 'push hard on the counter' : counter <= 2 ? 'hold back on the counter' : 'return to their usual counter game');
      }
      return `${team.short} change tactics: ${changes.join(' and ')}.`;
    }
  }
}

export function commentary(result: MatchResult): { quarter: number; clock: string; text: string; event: MatchEvent }[] {
  const players = playerLookup(result);
  return result.events.flatMap((e) => {
    const text = describeEvent(e, result, players);
    return text ? [{ quarter: e.quarter, clock: formatClock(e.clock), text, event: e }] : [];
  });
}
