import { useState } from 'react';
import type { LiveMatch, MatchResult, Player, Tactics } from '../../engine';
import { Crest } from './Crest';

const ROLE_NAMES = { GK: 'goalkeeper', CENTER: 'center', CDEF: 'center-defender', DRIVER: 'driver', WING: 'wing', POINT: 'point' } as const;

/**
 * In-match controls for the team the user manages: timeouts, tactics and substitutions.
 * Changes apply from the next possession.
 */
export function ManagerPanel({ live, team, result, onChange }: { live: LiveMatch; team: 0 | 1; result: MatchResult; onChange: () => void }) {
  const state = live.state();
  const me = state.teams[team];
  const club = result.teams[team];
  const players = new Map(club.players.map((p) => [p.id, p]));
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const setTactic = <K extends keyof Tactics>(key: K, value: Tactics[K]) => {
    live.setTactics(team, { [key]: value } as Partial<Tactics>);
    setMessage(`Tactics changed: ${key === 'defense' ? `defense → ${value}` : key === 'powerPlay' ? `6 on 5 → ${value}` : key === 'counterAggression' ? `counterattack → ${value}` : `front the center → ${value ? 'yes' : 'no'}`}.`);
    onChange();
  };

  const bringOn = (incoming: string) => {
    if (!outgoing) {
      setMessage('First pick the player to take off (in the water), then the one to bring on.');
      return;
    }
    const error = live.substitute(team, outgoing, incoming);
    setMessage(error ?? `${players.get(incoming)?.name} on for ${players.get(outgoing)?.name}.`);
    if (!error) setOutgoing(null);
    onChange();
  };

  // When a player is picked to come off, rank the bench for his role.
  const recs = outgoing ? live.recommendSubs(team, outgoing) : [];
  const recScore = new Map(recs.map((r, i) => [r.id, { score: r.score, rank: i }]));
  const role = recs[0]?.role ?? (outgoing ? players.get(outgoing)?.position : undefined);
  const bench = outgoing ? [...recs.map((r) => r.id), ...me.bench.filter((id) => !recScore.has(id))] : me.bench;

  const row = (id: string, where: 'water' | 'bench') => {
    const p = players.get(id) as Player;
    const rec = where === 'bench' ? recScore.get(id) : undefined;
    const unsuitable = where === 'bench' && !!outgoing && !rec;
    const energy = state.energy[id] ?? 100;
    const fouls = me.fouls[id] ?? 0;
    const unavailable = me.unavailable.includes(id);
    const selected = outgoing === id;
    return (
      <button
        key={id}
        className={`squad-row${selected ? ' selected' : ''}${unavailable ? ' unavailable' : ''}${rec?.rank === 0 ? ' best-fit' : ''}${unsuitable ? ' unsuitable' : ''}`}
        disabled={unavailable || unsuitable}
        onClick={() => (where === 'water' ? setOutgoing(selected ? null : id) : bringOn(id))}
        title={unavailable ? 'Out of the game' : where === 'water' ? 'Take off' : 'Bring on'}
      >
        <span className="squad-cap">{p.cap}</span>
        <span className="squad-name">{p.name}</span>
        <span className="squad-pos">
          {p.position}
          {rec && <span className={`fit-score${p.position === role ? ' same' : ''}`}>{rec.rank === 0 ? '★ ' : ''}{rec.score.toFixed(1)}</span>}
        </span>
        <span className="squad-energy">
          <span style={{ width: `${energy}%`, background: `hsl(${Math.round((energy / 100) * 120)} 70% 45%)` }} />
        </span>
        <span className={`squad-fouls${fouls >= 2 ? ' warn' : ''}`}>{'●'.repeat(Math.min(fouls, 3))}</span>
      </button>
    );
  };

  return (
    <section className="card manager">
      <div className="manager-head">
        <h3 className="box-title">
          <Crest team={club} size={26} /> You manage {club.name}
        </h3>
        <span className="muted small">Changes apply from the next possession</span>
      </div>

      <div className="manager-actions">
        <button
          className="primary"
          disabled={me.timeouts === 0 || me.pendingTimeout}
          onClick={() => {
            live.callTimeout(team);
            setMessage('Timeout requested: it is taken as soon as your team has the ball.');
            onChange();
          }}
        >
          ⏱ Timeout ({me.timeouts} left)
        </button>
        {me.pendingTimeout && <span className="man-up">Timeout requested</span>}
        <label>
          <input
            type="checkbox"
            checked={me.autoSubs}
            onChange={(e) => {
              live.setAutoSubs(team, e.target.checked);
              onChange();
            }}
          />{' '}
          Assistant handles rotation
        </label>
      </div>

      <div className="tactics manager-tactics">
        <label>
          Defense
          <select value={me.tactics.defense} onChange={(e) => setTactic('defense', e.target.value as Tactics['defense'])}>
            <option value="press">Press (man-to-man)</option>
            <option value="zone">Zone</option>
            <option value="mdrop">M-drop</option>
          </select>
        </label>
        <label>
          6 on 5 setup
          <select value={me.tactics.powerPlay} onChange={(e) => setTactic('powerPlay', e.target.value as Tactics['powerPlay'])}>
            <option value="4-2">4-2 (shooters)</option>
            <option value="3-3">3-3 (passing and posts)</option>
          </select>
        </label>
        <label>
          Counterattack: {me.tactics.counterAggression}
          <input type="range" min={1} max={5} value={me.tactics.counterAggression} onChange={(e) => setTactic('counterAggression', Number(e.target.value))} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={me.tactics.frontCenter} onChange={(e) => setTactic('frontCenter', e.target.checked)} /> Front the center
        </label>
      </div>

      <div className="manager-squad">
        <div>
          <div className="muted small">In the water: pick who comes off</div>
          {me.water.map((id) => row(id, 'water'))}
        </div>
        <div>
          <div className="muted small">
            {outgoing && role
              ? `Suggestions for the ${ROLE_NAMES[role]} role (ability, fitness and position). Any field player can go on.`
              : 'Bench: pick who goes on'}
          </div>
          {bench.map((id) => row(id, 'bench'))}
        </div>
      </div>
      {message && <p className="manager-message">{message}</p>}
    </section>
  );
}
