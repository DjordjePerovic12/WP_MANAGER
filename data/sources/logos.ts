// Club logos from the European Aquatics results pages (the images the public
// pages show), saved once into web/public/logos/ so the web page can show them.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { throttle, USER_AGENT } from '../http';

const LOGO_URL = (teamCode: string) =>
  `https://ea.microplustimingservices.com/lenchampionsleague202627_angular/assets//img/flags_club/ASM/${teamCode}.png`;
export const LOGO_DIR = join(import.meta.dirname, '..', '..', 'web', 'public', 'logos');

/** Download missing logos. Returns how many are now available. */
export async function fetchLogos(teamCodes: string[]): Promise<number> {
  mkdirSync(LOGO_DIR, { recursive: true });
  let available = 0;
  for (const code of teamCodes) {
    const file = join(LOGO_DIR, `EA-${code}.png`);
    if (existsSync(file)) {
      available++;
      continue;
    }
    await throttle();
    const res = await fetch(LOGO_URL(code), { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) continue;
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    available++;
  }
  return available;
}
