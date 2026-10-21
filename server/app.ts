// HTTP API (Hono). Read-only game data plus server-side match simulation.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { boxScore } from '../engine/stats';
import { simulateMatch } from '../engine/match';
import { DEFAULT_TACTICS } from '../engine/generate';
import type { Player, Position, Tactics, Team } from '../engine/types';
import { schema, type Db } from './db';

const { clubs, clubCompetitions, competitions, playerAttributes, playerMatchStats, players } = schema;

/** Load a club as an engine Team (squad with attributes). */
export async function loadTeam(db: Db, clubId: string, tactics?: Partial<Tactics>): Promise<Team | undefined> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) return undefined;
  const rows = await db
    .select()
    .from(players)
    .innerJoin(playerAttributes, eq(playerAttributes.playerId, players.id))
    .where(eq(players.clubId, clubId))
    .orderBy(players.cap);
  const squad: Player[] = rows.map(({ players: p, player_attributes: a }) => {
    const { playerId: _, ...attrs } = a;
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      cap: p.cap,
      position: p.position as Position,
      hand: p.hand as 'L' | 'R',
      age: p.birthDate ? new Date(Date.now() - Date.parse(p.birthDate)).getUTCFullYear() - 1970 : 26,
      attrs,
    };
  });
  return { id: club.id, name: club.name, short: club.id.replace(/^EA-/, ''), players: squad, tactics: { ...DEFAULT_TACTICS, ...tactics } };
}

export function createApp(db: Db) {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/competitions', async (c) => {
    const rows = await db
      .select({ id: competitions.id, name: competitions.name, tier: competitions.tier, clubs: sql<number>`count(${clubCompetitions.clubId})` })
      .from(competitions)
      .leftJoin(clubCompetitions, eq(clubCompetitions.competitionId, competitions.id))
      .groupBy(competitions.id)
      .orderBy(competitions.tier);
    return c.json(rows);
  });

  app.get('/clubs', async (c) => {
    const competition = c.req.query('competition');
    const playableOnly = c.req.query('playable') !== 'false';
    const ids = competition
      ? (await db.select({ id: clubCompetitions.clubId }).from(clubCompetitions).where(eq(clubCompetitions.competitionId, competition))).map((r) => r.id)
      : undefined;
    const rows = await db
      .select()
      .from(clubs)
      .where(and(ids ? inArray(clubs.id, ids.length ? ids : ['']) : undefined, playableOnly ? eq(clubs.playable, true) : undefined))
      .orderBy(sql`${clubs.rating} desc`);
    return c.json(rows);
  });

  app.get('/clubs/:id', async (c) => {
    const team = await loadTeam(db, c.req.param('id'));
    if (!team) return c.json({ error: 'Club not found' }, 404);
    const [club] = await db.select().from(clubs).where(eq(clubs.id, team.id));
    const comps = await db
      .select({ id: competitions.id, name: competitions.name })
      .from(clubCompetitions)
      .innerJoin(competitions, eq(competitions.id, clubCompetitions.competitionId))
      .where(eq(clubCompetitions.clubId, team.id));
    return c.json({ ...club, competitions: comps, squad: team.players });
  });

  app.get('/players/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(players).innerJoin(playerAttributes, eq(playerAttributes.playerId, players.id)).where(eq(players.id, id));
    if (!row) return c.json({ error: 'Player not found' }, 404);
    const [season] = await db
      .select({
        games: sql<number>`count(*)`,
        goals: sql<number>`coalesce(sum(${playerMatchStats.goals}), 0)`,
        attempts: sql<number>`coalesce(sum(${playerMatchStats.attempts}), 0)`,
        assists: sql<number>`coalesce(sum(${playerMatchStats.assists}), 0)`,
        steals: sql<number>`coalesce(sum(${playerMatchStats.steals}), 0)`,
        exclusions: sql<number>`coalesce(sum(${playerMatchStats.exclusions}), 0)`,
        saves: sql<number>`coalesce(sum(${playerMatchStats.saves}), 0)`,
        shotsFaced: sql<number>`coalesce(sum(${playerMatchStats.shotsFaced}), 0)`,
      })
      .from(playerMatchStats)
      .where(eq(playerMatchStats.playerId, id));
    const { playerId: _, ...attrs } = row.player_attributes;
    return c.json({ ...row.players, attrs, season });
  });

  /** Simulate a match between two clubs: { homeId, awayId, seed?, homeTactics?, awayTactics?, shootoutOnDraw? } */
  app.post('/simulate', async (c) => {
    const body = await c.req.json<{ homeId: string; awayId: string; seed?: number; homeTactics?: Partial<Tactics>; awayTactics?: Partial<Tactics>; shootoutOnDraw?: boolean }>();
    const [home, away] = await Promise.all([loadTeam(db, body.homeId, body.homeTactics), loadTeam(db, body.awayId, body.awayTactics)]);
    if (!home || !away) return c.json({ error: 'Unknown club' }, 404);
    if (home.id === away.id) return c.json({ error: 'A club cannot play itself' }, 400);
    const result = simulateMatch(home, away, { seed: body.seed, shootoutOnDraw: body.shootoutOnDraw ?? true });
    return c.json({ result, box: boxScore(result) });
  });

  return app;
}
