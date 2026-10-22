import { useState } from 'react';
import { overall } from '../../../engine';
import { ACADEMY_MAX_AGE, MAX_REGISTERED, PERSONALITY_HELP, PERSONALITY_LABELS, personalityOf, potentialStars, promoteYouth, releaseYouth, ROLE_LABELS, type CareerState } from '../../../game';
import { PlayerLink } from './PlayerProfile';
import { Stars } from './SeasonReview';

const ORDER = { GK: 0, CENTER: 1, CDEF: 2, DRIVER: 3, WING: 4, POINT: 5 } as const;

/** The youth academy: youngsters developing until the manager promotes them or they turn 20. */
export function AcademyTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const [message, setMessage] = useState('');
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const head = career.staff.youth;
  const youth = [...(career.academy ?? [])].sort((a, b) => b.age - a.age || ORDER[a.position] - ORDER[b.position] || overall(b) - overall(a));
  const full = club.players.length >= MAX_REGISTERED;
  const act = (out: { message: string; state: CareerState }) => {
    setMessage(out.message);
    onChange(out.state);
  };
  return (
    <div className="card">
      <h3>Youth academy</h3>
      <p className="muted small">
        {head ? (
          <>
            {ROLE_LABELS.youth}: <b>{head.name}</b> ({head.rating}/20)
          </>
        ) : (
          <span className="warn-text">No {ROLE_LABELS.youth.toLowerCase()}: hire one in the Staff tab for more and better youngsters.</span>
        )}{' '}
        · A new intake joins every summer. Players develop here week by week; at {ACADEMY_MAX_AGE + 1} they must be in the first team or they leave. First team: {club.players.length}/{MAX_REGISTERED}.
      </p>
      {message && <p className="manager-message">{message}</p>}
      {youth.length === 0 ? (
        <p className="muted">The academy is empty: the next intake arrives in the summer.</p>
      ) : (
        <div className="table-scroll">
          <table className="squad-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th>Age</th>
                <th>Pos</th>
                <th>Ovr</th>
                <th>Potential</th>
                <th>Character</th>
                <th title="Progress toward the next attribute point">Training</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {youth.map((p) => {
                const personality = personalityOf(career.seed, p.id);
                const last = p.age >= ACADEMY_MAX_AGE;
                return (
                  <tr key={p.id} className={last ? 'ending' : ''}>
                    <td style={{ textAlign: 'left' }}>
                      <PlayerLink id={p.id}>{p.name}</PlayerLink>
                    </td>
                    <td>{last ? <b className="down" title="His last year in the academy">{p.age}</b> : p.age}</td>
                    <td>{p.position}</td>
                    <td>{overall(p).toFixed(1)}</td>
                    <td>
                      <Stars value={potentialStars(career.potential[p.id] ?? overall(p))} />
                    </td>
                    <td>
                      <span className={`personality personality-${personality}`} title={PERSONALITY_HELP[personality]}>
                        {PERSONALITY_LABELS[personality]}
                      </span>
                    </td>
                    <td>
                      <span className="attr-bar" style={{ width: 60, display: 'inline-block' }}>
                        <span style={{ width: `${Math.min(100, (career.academyProgress?.[p.id] ?? 0) * 100)}%` }} />
                      </span>
                    </td>
                    <td>
                      <span className="row-actions">
                        <button className="primary" disabled={full} title={full ? 'The first-team squad is full' : 'Give him a first-team contract'} onClick={() => act(promoteYouth(career, p.id))}>
                          Promote
                        </button>
                        <button className="link-danger" onClick={() => confirm(`Let ${p.name} go?`) && act(releaseYouth(career, p.id))}>
                          Release
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {youth.some((p) => p.age >= ACADEMY_MAX_AGE) && (
        <p className="warn-text small">Players marked red are in their last academy year: promote them before the summer or they leave.</p>
      )}
    </div>
  );
}
