import { useEffect, useState } from 'react';
import { DEFAULT_TACTICS, generateLeague, type Player, type Team } from '../../engine';

export interface TeamGroup {
  label: string;
  teamIds: string[];
}

export interface League {
  source: 'real' | 'generated';
  teams: Team[];
  groups: TeamGroup[];
}

interface ApiCompetition { id: string; name: string; tier: number }
interface ApiClub { id: string; name: string; rating: number }

const GENERATED: League = (() => {
  const teams = generateLeague(2026);
  return { source: 'generated', teams, groups: [{ label: 'Fictional clubs', teamIds: teams.map((t) => t.id) }] };
})();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** Real clubs from the local API, grouped by their strongest competition. */
async function loadRealLeague(): Promise<League> {
  const competitions = await getJson<ApiCompetition[]>('/api/competitions');
  const seen = new Set<string>();
  const groups: TeamGroup[] = [];
  const summaries: ApiClub[] = [];
  for (const comp of competitions.filter((c) => c.name !== 'Super Cup')) {
    const clubs = (await getJson<ApiClub[]>(`/api/clubs?competition=${comp.id}`)).filter((c) => !seen.has(c.id));
    clubs.forEach((c) => seen.add(c.id));
    if (clubs.length) groups.push({ label: comp.name, teamIds: clubs.map((c) => c.id) });
    summaries.push(...clubs);
  }
  if (!summaries.length) throw new Error('No clubs in the database');
  const teams = await Promise.all(
    summaries.map(async (c): Promise<Team> => {
      const club = await getJson<{ id: string; name: string; squad: Player[] }>(`/api/clubs/${c.id}`);
      return { id: club.id, name: club.name, short: club.id.replace(/^EA-/, ''), players: club.squad, tactics: { ...DEFAULT_TACTICS } };
    }),
  );
  return { source: 'real', teams, groups };
}

/** Real clubs when the API is running, otherwise generated fictional clubs. */
export function useLeague(): League | null {
  const [league, setLeague] = useState<League | null>(null);
  useEffect(() => {
    loadRealLeague()
      .then(setLeague)
      .catch(() => setLeague(GENERATED));
  }, []);
  return league;
}
