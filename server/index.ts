// Local API server.  Usage: npm run server  → http://localhost:8787/api
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { DB_PATH, openDatabase } from './db';

const port = Number(process.env.PORT ?? 8787);
const { db } = openDatabase();
serve({ fetch: createApp(db).fetch, port }, () => console.log(`API on http://localhost:${port}/api (database: ${DB_PATH})`));
