import { useEffect, useState, type ReactNode } from 'react';
import { overall, type Attributes, type Player } from '../../engine';
import { ATTRIBUTE_LABELS } from '../../game';
import { ProfileContext } from './career/PlayerProfile';

interface ApiPlayer {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  nationality: string | null;
  clubId: string;
  cap: number;
  heightCm: number | null;
  hand: 'L' | 'R';
  handGuessed: boolean;
  position: Player['position'];
  attrs: Attributes;
  season: { games: number; goals: number; attempts: number; assists: number; steals: number; exclusions: number; saves: number; shotsFaced: number };
}

const age = (birth: string | null) => {
  if (!birth) return undefined;
  const [y, m, d] = birth.split('-').map(Number);
  const now = new Date();
  return now.getUTCFullYear() - y - (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d) ? 1 : 0);
};

/** Outside a career (friendlies): any player's card from the database, with his real 2026-27 numbers. */
export function RealPlayerCard({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const [p, setP] = useState<ApiPlayer | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/players/${encodeURIComponent(playerId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setP)
      .catch(() => setError('This player has no record in the database (a generated player).'));
  }, [playerId]);
  const gk = p?.position === 'GK';
  const keys = (gk
    ? ['reflexes', 'gkPositioning', 'legStrength', 'positioning', 'gameIQ', 'passing', 'speed', 'stamina']
    : ['speed', 'stamina', 'shootingPower', 'shootingAccuracy', 'passing', 'legStrength', 'wrestling', 'positioning', 'gameIQ']) as (keyof Attributes)[];
  const s = p?.season;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card profile" role="dialog" onClick={(e) => e.stopPropagation()}>
        <button className="player-card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {error && <p className="muted">{error}</p>}
        {!p && !error && <p className="muted">Loading…</p>}
        {p && (
          <>
            <div className="player-card-name">
              {p.cap ? `#${p.cap} ` : ''}
              {p.firstName} {p.lastName}
            </div>
            <div className="muted small">
              {p.position} · {p.hand === 'L' ? 'left' : 'right'}-handed{p.handGuessed ? ' (assumed)' : ''}
              {age(p.birthDate) !== undefined && ` · age ${age(p.birthDate)}`}
              {p.heightCm && ` · ${p.heightCm} cm`}
              {p.nationality && ` · ${p.nationality}`} · overall {overall({ ...p, id: p.id, name: '', age: 0, attrs: p.attrs } as Player).toFixed(1)}
            </div>
            <div className="profile-grid">
              <div>
                <h4>Attributes</h4>
                <div className="player-card-attrs">
                  {keys.map((k) => (
                    <div key={k} className="attr-row">
                      <span>{ATTRIBUTE_LABELS[k]}</span>
                      <span className="attr-bar">
                        <span style={{ width: `${(p.attrs[k] / 20) * 100}%` }} />
                      </span>
                      <b>{p.attrs[k]}</b>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4>Real 2026-27 so far</h4>
                {!s?.games ? (
                  <p className="muted small">No games recorded yet.</p>
                ) : (
                  <dl className="profile-facts">
                    <dt>Games</dt>
                    <dd>{s.games}</dd>
                    {gk ? (
                      <>
                        <dt>Saves</dt>
                        <dd>
                          {s.saves} of {s.shotsFaced} ({s.shotsFaced ? Math.round((s.saves / s.shotsFaced) * 100) : 0}%)
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt>Goals</dt>
                        <dd>
                          {s.goals} ({(s.goals / s.games).toFixed(1)} a game)
                        </dd>
                        <dt>Shooting</dt>
                        <dd>
                          {s.goals}/{s.attempts} ({s.attempts ? Math.round((s.goals / s.attempts) * 100) : 0}%)
                        </dd>
                        <dt>Assists</dt>
                        <dd>{s.assists}</dd>
                        <dt>Steals</dt>
                        <dd>{s.steals}</dd>
                        <dt>Exclusions</dt>
                        <dd>{s.exclusions}</dd>
                      </>
                    )}
                  </dl>
                )}
                <p className="muted small">European cups and the domestic leagues we have data for (Croatia, Hungary, Malta).</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Friendlies: player names open the database card. */
export function RealProfileProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ProfileContext.Provider value={setOpen}>
      {children}
      {open && <RealPlayerCard playerId={open} onClose={() => setOpen(null)} />}
    </ProfileContext.Provider>
  );
}
