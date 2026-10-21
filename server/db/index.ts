// Local database: Node's built-in SQLite behind Drizzle's proxy driver
// (no native modules to compile). Swap for a Postgres driver when deploying.

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';

export const DB_PATH = process.env.DB_PATH ?? join(import.meta.dirname, '..', '..', 'local', 'waterpolo.db');

export function openDatabase(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  sqlite.exec(readFileSync(join(import.meta.dirname, 'migrations.sql'), 'utf8'));

  const db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql);
      if (method === 'run') {
        stmt.run(...(params as never[]));
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      const rows = stmt.all(...(params as never[])) as unknown as unknown[][];
      return { rows: method === 'get' ? (rows[0] ?? []) : rows } as { rows: any[] };
    },
    { schema },
  );
  return { db, sqlite };
}

export type Db = ReturnType<typeof openDatabase>['db'];
export { schema };
