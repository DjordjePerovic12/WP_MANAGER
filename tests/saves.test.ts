import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDatabase, schema } from '../server/db';

describe('career saves API', async () => {
  const { db } = openDatabase(':memory:');
  await db.insert(schema.clubs).values({ id: 'EA-NBG', name: 'Novi Beograd', shortName: 'NBG', country: 'SRB', rating: 15, playable: true });
  const app = createApp(db);
  const put = (id: string, body: unknown) => app.request(`/api/saves/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('creates, lists, loads, updates and deletes a save', async () => {
    const state = { season: '2026-27', fixtures: [{ id: 'R1-1' }], nested: { a: [1, 2] } };
    expect((await put('career-1', { name: 'NBG 26/27', clubId: 'EA-NBG', state })).status).toBe(200);
    const list = await (await app.request('/api/saves')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'career-1', name: 'NBG 26/27', clubId: 'EA-NBG' });
    const loaded = await (await app.request('/api/saves/career-1')).json();
    expect(loaded.state).toEqual(state);

    await put('career-1', { name: 'NBG 26/27', clubId: 'EA-NBG', state: { ...state, season: 'changed' } });
    expect((await (await app.request('/api/saves/career-1')).json()).state.season).toBe('changed');
    expect(await (await app.request('/api/saves')).json()).toHaveLength(1);

    await app.request('/api/saves/career-1', { method: 'DELETE' });
    expect((await app.request('/api/saves/career-1')).status).toBe(404);
  });

  it('rejects incomplete saves and unknown clubs', async () => {
    expect((await put('x', { name: 'x', clubId: 'EA-NBG' })).status).toBe(400);
    expect((await put('x', { name: 'x', clubId: 'EA-NOPE', state: {} })).status).toBe(400);
  });
});
