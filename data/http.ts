// Polite HTTP fetching with an on-disk cache, so each URL is downloaded once
// and re-runs work offline. Delete data/cache/ to force a refresh.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const USER_AGENT = 'WaterPoloManagerHobby/0.1 (non-commercial hobby project)';
export const CACHE_DIR = join(import.meta.dirname, 'cache');
const MIN_INTERVAL_MS = 1000;

let lastRequest = 0;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait so that requests to remote sites are at least MIN_INTERVAL_MS apart. */
export async function throttle(ms = MIN_INTERVAL_MS) {
  const wait = lastRequest + ms - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
}

export function cachePath(namespace: string, key: string) {
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 8);
  return join(CACHE_DIR, namespace, `${safe}-${hash}.json`);
}

export function readCache<T>(namespace: string, key: string): T | undefined {
  const file = cachePath(namespace, key);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
}

export function writeCache(namespace: string, key: string, data: unknown) {
  const file = cachePath(namespace, key);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

/** GET a JSON URL, from the cache when possible. */
export async function getJson<T>(namespace: string, url: string): Promise<T> {
  const cached = readCache<T>(namespace, url);
  if (cached !== undefined) return cached;
  for (let attempt = 1; ; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as T;
      writeCache(namespace, url, data);
      return data;
    }
    if (attempt >= 3 || res.status < 500) throw new Error(`GET ${url} -> ${res.status}`);
    await sleep(2000 * attempt);
  }
}
