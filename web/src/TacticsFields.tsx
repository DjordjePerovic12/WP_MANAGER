import type { Tactics } from '../../engine';

/** The tactics form used before a match and in the career. */
export function TacticsFields({ tactics: t, onChange, className = 'tactics' }: { tactics: Tactics; onChange: (t: Tactics) => void; className?: string }) {
  const set = <K extends keyof Tactics>(key: K, value: Tactics[K]) => onChange({ ...t, [key]: value });
  return (
    <div className={className}>
      <label>
        Defense
        <select value={t.defense} onChange={(e) => set('defense', e.target.value as Tactics['defense'])}>
          <option value="press">Press (man-to-man)</option>
          <option value="zone">Zone</option>
          <option value="mdrop">M-drop</option>
        </select>
      </label>
      <label>
        6 on 5 setup
        <select value={t.powerPlay} onChange={(e) => set('powerPlay', e.target.value as Tactics['powerPlay'])}>
          <option value="4-2">4-2 (shooters)</option>
          <option value="3-3">3-3 (passing and posts)</option>
        </select>
      </label>
      <label>
        Counterattack: {t.counterAggression}
        <input type="range" min={1} max={5} value={t.counterAggression} onChange={(e) => set('counterAggression', Number(e.target.value))} />
      </label>
      <label className="inline">
        <input type="checkbox" checked={t.frontCenter} onChange={(e) => set('frontCenter', e.target.checked)} /> Front the center
      </label>
    </div>
  );
}
