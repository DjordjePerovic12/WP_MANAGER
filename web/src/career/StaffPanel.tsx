import { useState } from 'react';
import { fireStaff, formatMoney, hireStaff, ROLE_HELP, ROLE_LABELS, STAFF_ROLES, wageRoom, type CareerState } from '../../../game';

function RatingBar({ value }: { value: number }) {
  return (
    <span className="staff-rating" title={`${value}/20`}>
      <span className="attr-bar">
        <span
          style={{
            width: `${(value / 20) * 100}%`,
            background: value >= 15 ? '#2a9d5c' : value >= 10 ? 'var(--accent)' : '#c27c0e',
          }}
        />
      </span>
      <b>{value}</b>
    </span>
  );
}

/** The backroom staff: who holds each role, and candidates to hire. */
export function StaffPanel({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const [message, setMessage] = useState('');
  const room = wageRoom(career);
  return (
    <div className="card">
      <h3>Staff</h3>
      {message && <p className="manager-message">{message}</p>}
      <p className="muted small">
        Coaches speed up training in their area, the fitness coach and physio keep players fit, and the chief scout writes your scouting reports. Their wages come out of the wage budget (room left:{' '}
        <b>{formatMoney(room)}</b>). An empty role works like a poor coach.
      </p>
      <div className="staff-list">
        {STAFF_ROLES.map((role) => {
          const m = career.staff[role];
          const candidates = career.staffMarket.filter((c) => c.role === role).sort((a, b) => a.rating - b.rating);
          return (
            <div key={role} className={`staff-row${m ? '' : ' vacant'}`}>
              <div className="staff-main">
                <div>
                  <b>{ROLE_LABELS[role]}</b>
                  <div className="muted small">{ROLE_HELP[role]}</div>
                </div>
                {m ? (
                  <div className="staff-person">
                    <span>
                      {m.name} <span className="muted small">({m.age})</span>
                    </span>
                    <RatingBar value={m.rating} />
                    <span className="muted small">{formatMoney(m.wage)}/season</span>
                  </div>
                ) : (
                  <div className="staff-person warn-text">Vacant</div>
                )}
                <div className="staff-actions">
                  {m && (
                    <button
                      className="link-danger"
                      onClick={() => {
                        if (!confirm(`Let ${m.name} go? Half a season's wage (${formatMoney(Math.round(m.wage / 2))}) is paid off.`)) return;
                        const out = fireStaff(career, role);
                        setMessage(out.message);
                        onChange(out.state);
                      }}
                    >
                      Let go
                    </button>
                  )}
                </div>
              </div>
              {
                <div className="staff-candidates">
                  <span className="muted small">{candidates.length ? `Available ${m ? 'to replace him' : 'to hire'}:` : ''}</span>
                  {candidates.length === 0 && <p className="muted small">No candidates left this season.</p>}
                  {candidates.map((c) => (
                    <div key={c.id} className="offer-row">
                      <span>
                        {c.name} <span className="muted small">({c.age})</span>
                      </span>
                      <RatingBar value={c.rating} />
                      <span className="muted small">{formatMoney(c.wage)}/season</span>
                      <button
                        className="primary"
                        onClick={() => {
                          const out = hireStaff(career, c.id);
                          setMessage(out.message);
                          onChange(out.state);
                        }}
                      >
                        {m ? 'Replace' : 'Hire'}
                      </button>
                    </div>
                  ))}
                  {m && candidates.length > 0 && <p className="muted small">Replacing {m.name} pays him off with half a season's wage.</p>}
                </div>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}
