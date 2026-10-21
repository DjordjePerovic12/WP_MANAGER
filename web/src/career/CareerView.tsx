import { useEffect, useState } from 'react';
import { teamRating } from '../../../engine';
import { createCareer, LEAGUES, migrateCareer, type CareerState, type LeagueDef } from '../../../game';
import type { League } from '../api';
import { Crest } from '../Crest';
import { CareerHub } from './CareerHub';

interface SaveSummary {
  id: string;
  name: string;
  clubId: string;
  updatedAt: string;
}

export async function saveCareer(state: CareerState) {
  const club = state.teams.find((t) => t.id === state.managedClubId)!;
  const res = await fetch(`/api/saves/${encodeURIComponent(state.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${club.name} · ${state.leagueName} ${state.season}`, clubId: state.managedClubId, state }),
  });
  if (!res.ok) throw new Error(`Saving failed (${res.status})`);
}

/** Real clubs available for a league, strongest first. */
function clubsFor(league: League, def: LeagueDef) {
  return league.teams.filter((t) => def.countries.includes(league.countries[t.id])).sort((a, b) => teamRating(b.players) - teamRating(a.players));
}

export function CareerView({ league }: { league: League }) {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null);
  const [career, setCareer] = useState<CareerState | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadSaves = () =>
    fetch('/api/saves')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setSaves)
      .catch(() => setError('Career mode needs the local API. Start it with: npm run server'));

  useEffect(() => {
    if (league.source === 'real') void loadSaves();
    else setError('Career mode uses the real clubs. Start the local API with: npm run server, then reload.');
  }, [league.source]);

  const open = async (id: string) => {
    const res = await fetch(`/api/saves/${encodeURIComponent(id)}`);
    if (!res.ok) return setError('Could not load that career.');
    setCareer(migrateCareer((await res.json()).state as CareerState));
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this career? This cannot be undone.')) return;
    await fetch(`/api/saves/${encodeURIComponent(id)}`, { method: 'DELETE' });
    void loadSaves();
  };

  if (error) return <p className="card">{error}</p>;
  if (career)
    return (
      <CareerHub
        career={career}
        onChange={async (next) => {
          setCareer(next);
          try {
            await saveCareer(next);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        onExit={() => {
          setCareer(null);
          void loadSaves();
        }}
      />
    );
  if (creating)
    return (
      <NewCareer
        league={league}
        onCancel={() => setCreating(false)}
        onStart={async (state) => {
          await saveCareer(state);
          setCreating(false);
          setCareer(state);
        }}
      />
    );

  return (
    <section className="career-menu">
      <div className="card">
        <h2>Career</h2>
        <p className="muted">Take charge of a real club for the {`2026-27`} season: play your matches live, follow the table, and chase the title.</p>
        <button className="primary" onClick={() => setCreating(true)}>
          + New career
        </button>
      </div>
      {saves && saves.length > 0 && (
        <div className="card">
          <h3>Continue</h3>
          {saves.map((s) => {
            const club = league.teams.find((t) => t.id === s.clubId);
            return (
              <div key={s.id} className="save-row">
                <button className="save-open" onClick={() => open(s.id)}>
                  {club && <Crest team={club} size={28} />}
                  <span>
                    <b>{s.name}</b>
                    <span className="muted small"> · saved {new Date(s.updatedAt).toLocaleString()}</span>
                  </span>
                </button>
                <button className="link-danger" onClick={() => remove(s.id)} aria-label={`Delete ${s.name}`}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NewCareer({ league, onStart, onCancel }: { league: League; onStart: (s: CareerState) => void; onCancel: () => void }) {
  const available = LEAGUES.filter((def) => clubsFor(league, def).length >= 2);
  const [leagueId, setLeagueId] = useState(available[0]?.id);
  const [clubId, setClubId] = useState<string | null>(null);
  const def = available.find((l) => l.id === leagueId);
  const clubs = def ? clubsFor(league, def) : [];

  const start = () => {
    if (!def || !clubId) return;
    const seed = Math.floor(Math.random() * 2 ** 31);
    onStart(createCareer({ league: def, realTeams: clubs, managedClubId: clubId, seed, id: `career-${Date.now()}` }));
  };

  return (
    <section className="card new-career">
      <h2>New career</h2>
      <h3>1. Choose a league</h3>
      <div className="league-grid">
        {available.map((l) => {
          const real = clubsFor(league, l).length;
          const total = Math.max(l.size, real);
          return (
            <button key={l.id} className={`league-card${l.id === leagueId ? ' selected' : ''}`} onClick={() => { setLeagueId(l.id); setClubId(null); }}>
              <b>{l.name}</b>
              <span className="muted small">
                {total} clubs · {real} real{total > real ? `, ${total - real} generated` : ''}
              </span>
            </button>
          );
        })}
      </div>
      {def && (
        <>
          <h3>2. Choose your club</h3>
          <div className="club-grid">
            {clubs.map((c) => (
              <button key={c.id} className={`club-card${c.id === clubId ? ' selected' : ''}`} onClick={() => setClubId(c.id)}>
                <Crest team={c} size={36} />
                <span>
                  <b>{c.name}</b>
                  <span className="muted small">Squad rating {teamRating(c.players).toFixed(1)}</span>
                </span>
              </button>
            ))}
          </div>
          {def.size > clubs.length && (
            <p className="muted small">
              {def.size - clubs.length} more clubs with fictional names and players are added to complete the league, because our data only covers clubs from the European cups.
            </p>
          )}
        </>
      )}
      <div className="controls">
        <button className="primary" disabled={!clubId} onClick={start}>
          Start career
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
