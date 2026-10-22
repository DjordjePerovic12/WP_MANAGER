import { useState } from 'react';
import { overall, type Player } from '../../../engine';
import { matchdaySquad, MATCHDAY_MINIMUM, MATCHDAY_SIZE, potentialStars, setSelection, validStarters, type CareerState } from '../../../game';
import { PlayerLink } from './PlayerProfile';
import { Stars } from './SeasonReview';

/** "1 GK · 3 C · 2 CD · 4 D · 2 W · 1 P" */
function positionMix(players: Player[]) {
  const short = { GK: 'GK', CENTER: 'C', CDEF: 'CD', DRIVER: 'D', WING: 'W', POINT: 'P' } as const;
  return (Object.keys(short) as (keyof typeof short)[])
    .map((pos) => [pos, players.filter((p) => p.position === pos).length] as const)
    .filter(([, n]) => n)
    .map(([pos, n]) => `${n} ${short[pos]}`)
    .join(' · ');
}

/** Fitness bar coloured from red (exhausted) to green (fresh). */
export function Fitness({ value }: { value: number }) {
  return (
    <span className="fitness" title={`Fitness ${value}%`}>
      <span style={{ width: `${value}%`, background: `hsl(${Math.round((value / 100) * 120)} 70% 45%)` }} />
    </span>
  );
}

/**
 * The squad: fitness, injuries and season stats, plus the matchday selection
 * (13 players) and starting seven. The assistant fills anything left open.
 */
export function SquadTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const club = career.teams.find((t) => t.id === career.managedClubId)!;
  const byId = new Map(club.players.map((p) => [p.id, p]));
  const effective = matchdaySquad(career, club.id);
  // Starters being picked (possibly fewer than 7 so far); the engine only uses a complete, valid seven.
  const starters = (career.selection?.starters ?? []).filter((id) => effective.includes(id));
  const chosenStarters = validStarters(club, effective, starters);
  const manual = !!career.selection;

  const update = (matchday: string[], nextStarters: string[]) => onChange(setSelection(career, { matchday, starters: nextStarters }));
  const isGk = (id: string) => byId.get(id)!.position === 'GK';

  const [message, setMessage] = useState('');

  const toggleMatchday = (id: string) => {
    setMessage('');
    if (effective.includes(id)) {
      const matchday = effective.filter((x) => x !== id);
      if (isGk(id) && !matchday.some(isGk)) return setMessage('You need at least one goalkeeper in the squad.');
      if (matchday.length < MATCHDAY_MINIMUM) return setMessage(`You need at least ${MATCHDAY_MINIMUM} players.`);
      return update(
        matchday,
        starters.filter((x) => x !== id),
      );
    }
    if (effective.length >= MATCHDAY_SIZE) return setMessage(`Your ${MATCHDAY_SIZE} are full: untick someone first.`);
    update([...effective, id], starters);
  };

  const toggleStarter = (id: string) => {
    if (!effective.includes(id)) return;
    let next = starters.includes(id) ? starters.filter((x) => x !== id) : [...starters, id];
    const keeper = next.filter(isGk);
    if (keeper.length > 1) next = next.filter((x) => !isGk(x) || x === id);
    const field = next.filter((x) => !isGk(x));
    if (field.length > 6) next = next.filter((x) => x !== field[0]);
    // Goalkeeper first.
    next = [...next.filter(isGk), ...next.filter((x) => !isGk(x))];
    update(effective, next);
  };

  const fieldStarters = starters.filter((x) => !isGk(x)).length;
  const keeperStarters = starters.filter(isGk).length;
  const rows = [...club.players].sort((a, b) => Number(b.position === 'GK') - Number(a.position === 'GK') || a.cap - b.cap);

  return (
    <div className="card">
      <div className="squad-head">
        <div>
          <h3>Squad</h3>
          <p className="muted small">
            Tick up to {MATCHDAY_SIZE} for the next match, in any mix of positions (at least one goalkeeper), and star your starting seven. Until you pick, the assistant names the fittest best
            players.
          </p>
        </div>
        <div className="squad-summary">
          <span className={`badge${effective.length === MATCHDAY_SIZE ? '' : ' warn'}`} title={effective.length < MATCHDAY_SIZE ? 'You can name more players' : undefined}>
            Matchday <b>{effective.length}</b>/{MATCHDAY_SIZE}
          </span>
          <span className="badge muted">{positionMix(effective.map((id) => byId.get(id)!))}</span>
          <span className={`badge${chosenStarters ? '' : ' muted'}`}>Starting 7: {chosenStarters ? 'set' : `${keeperStarters} GK + ${fieldStarters}/6 · assistant picks`}</span>
          {manual && (
            <button onClick={() => onChange(setSelection(career, undefined))} title="Let the assistant choose the squad and starters">
              Assistant picks
            </button>
          )}
        </div>
      </div>
      {message && <p className="manager-message">{message}</p>}
      <div className="table-scroll">
        <table className="squad-table manage">
          <thead>
            <tr>
              <th title="In the matchday squad">13</th>
              <th title="Starting seven">Start</th>
              <th>#</th>
              <th>Name</th>
              <th>Pos</th>
              <th>Age</th>
              <th title="Overall rating">Ovr</th>
              <th title="Potential (estimate)">Pot</th>
              <th>Fitness</th>
              <th>Status</th>
              <th title="Appearances">Apps</th>
              <th title="Goals">G</th>
              <th title="Assists">A</th>
              <th title="Saves">Sv</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: Player) => {
              const cond = career.squad[p.id] ?? { condition: 100 };
              const s = career.playerStats[p.id];
              const inSquad = effective.includes(p.id);
              const starting = starters.includes(p.id);
              return (
                <tr key={p.id} className={`${cond.injury ? 'injured' : ''}${inSquad ? ' in-squad' : ''}`}>
                  <td>
                    <input type="checkbox" checked={inSquad} disabled={!!cond.injury} onChange={() => toggleMatchday(p.id)} aria-label={`Matchday squad: ${p.name}`} />
                  </td>
                  <td>
                    <button className={`star${starting ? ' on' : ''}`} disabled={!inSquad} onClick={() => toggleStarter(p.id)} aria-label={`Starting seven: ${p.name}`}>
                      ★
                    </button>
                  </td>
                  <td>{p.cap}</td>
                  <td>
                    <PlayerLink id={p.id}>{p.name}</PlayerLink>
                  </td>
                  <td>{p.position}</td>
                  <td>{p.age}</td>
                  <td>{overall(p).toFixed(1)}</td>
                  <td>
                    <Stars value={potentialStars(career.potential?.[p.id] ?? overall(p))} />
                  </td>
                  <td>
                    <Fitness value={cond.condition} />
                  </td>
                  <td>
                    {cond.injury ? (
                      <span className="injury-tag">
                        {cond.injury.name} · {cond.injury.weeksLeft}w
                      </span>
                    ) : cond.condition < 60 ? (
                      <span className="muted">Tired</span>
                    ) : (
                      ''
                    )}
                  </td>
                  <td>{s?.apps ?? 0}</td>
                  <td>{s?.goals || ''}</td>
                  <td>{s?.assists || ''}</td>
                  <td>{s?.saves || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
