// World Aquatics public JSON API (api.worldaquatics.com): open, no key needed.
// Used to fill in player heights for anyone who has played internationally.

import { getJson } from '../http';

const API = 'https://api.worldaquatics.com/fina';

export interface WaAthlete {
  id: number;
  firstName: string;
  lastName: string;
  dateOfBirth?: string; // yyyy-mm-dd
  nationality: string;
  height?: number;
  gender: string;
}

interface Page<T> {
  pageInfo: { page: number; numPages: number };
  content: T[];
}

/** All water polo athletes of one nationality (cached per page). */
export async function fetchWaterPoloAthletes(nationality: string): Promise<WaAthlete[]> {
  const all: WaAthlete[] = [];
  for (let page = 0; ; page++) {
    const url = `${API}/athletes?discipline=WP&nationality=${nationality}&gender=M&pageSize=100&page=${page}`;
    const res = await getJson<Page<WaAthlete>>('worldaquatics', url);
    all.push(...res.content);
    if (page + 1 >= res.pageInfo.numPages) break;
  }
  return all;
}
