import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { overall, type MatchResult, type Player } from '../../../engine';
import { Crest } from '../Crest';
import { LENGTH, WIDTH, type Dot } from './scene';
import { buildTimeline, EXCLUSION_SECONDS, liveStats, type Moment } from './timeline';

const CAP_COLORS = {
  home: { fill: '#f4f6f8', number: '#14212b', ear: '#c9d2da' },
  away: { fill: '#1f4fa3', number: '#ffffff', ear: '#163a7a' },
  keeper: { fill: '#d62828', number: '#ffffff', ear: '#a51d1d' },
};
const SHOT_COLORS = { goal: '#38d97a', save: '#ffb703', miss: '#c7d0d8', block: '#ef476f' };
const RING = 2 * Math.PI * 0.95;

/** A water polo cap seen from above: the head, two ear guards, and the cap number. */
export function Cap(props: { dot: Dot; fouls: number; energy?: number; exclusionLeft?: number; selected: boolean; onSelect: () => void }) {
  const { dot, fouls, exclusionLeft } = props;
  const colors = dot.goalkeeper ? CAP_COLORS.keeper : dot.team === 0 ? CAP_COLORS.home : CAP_COLORS.away;
  // Goalkeepers wear red; a thin ring in the team colour shows whose keeper it is.
  const ring = dot.goalkeeper ? (dot.team === 0 ? CAP_COLORS.home.fill : CAP_COLORS.away.fill) : 'rgba(0,0,0,0.35)';
  return (
    <g
      className={`cap${dot.highlight ? ' cap-highlight' : ''}${dot.excluded ? ' cap-excluded' : ''}${props.selected ? ' cap-selected' : ''}`}
      style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }}
      onClick={props.onSelect}
      role="button"
      aria-label={`Cap ${dot.cap}`}
    >
      {dot.highlight && <circle r={0.95} className="cap-halo" />}
      {props.selected && <circle r={1.05} className="cap-selected-ring" />}
      {exclusionLeft !== undefined && (
        <circle
          r={0.95}
          className="exclusion-ring"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - exclusionLeft / EXCLUSION_SECONDS)}
          transform="rotate(-90)"
        />
      )}
      <ellipse cx={-0.5} cy={0} rx={0.17} ry={0.28} fill={colors.ear} />
      <ellipse cx={0.5} cy={0} rx={0.17} ry={0.28} fill={colors.ear} />
      <circle r={0.52} fill={colors.fill} stroke={ring} strokeWidth={dot.goalkeeper ? 0.12 : 0.05} />
      <text y={0.2} textAnchor="middle" fontSize={0.56} fontWeight={700} fill={colors.number}>
        {dot.cap}
      </text>
      {/* Energy: a thin bar above the cap, green when fresh, red when exhausted. */}
      {props.energy !== undefined && !dot.goalkeeper && (
        <g className="energy" transform="translate(-0.5 -0.86)">
          <rect width={1} height={0.14} rx={0.07} className="energy-track" />
          <rect width={Math.max(0.05, props.energy / 100)} height={0.14} rx={0.07} fill={`hsl(${Math.round((props.energy / 100) * 120)} 75% 48%)`} />
        </g>
      )}
      {/* Personal fouls: one dot each (three means out of the game). */}
      {Array.from({ length: Math.min(fouls, 3) }, (_, i) => (
        <circle key={i} cx={-0.32 + i * 0.32} cy={0.82} r={0.11} className={fouls >= 3 ? 'foul-dot foul-out' : 'foul-dot'} />
      ))}
    </g>
  );
}

export function PoolView({ result, eventIndex, stepMs }: { result: MatchResult; eventIndex: number; stepMs: number }) {
  const moments = useMemo(() => buildTimeline(result), [result]);
  const index = Math.max(0, Math.min(eventIndex, moments.length - 1));
  const m: Moment | undefined = moments[index];
  const [selected, setSelected] = useState<string | null>(null);
  const ballRef = useRef<SVGGElement>(null);

  // Ball: travel along the passing route, then the shot.
  const travelMs = Number.isFinite(stepMs) ? Math.max(250, stepMs * 0.75) : 250;
  useLayoutEffect(() => {
    const el = ballRef.current;
    if (!el || !m) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const frames = m.ballPath.map((p) => ({ transform: `translate(${p.x + 0.45}px, ${p.y - 0.45}px)` }));
    if (reduce || stepMs === 0 || frames.length < 2) {
      el.style.transform = frames[frames.length - 1].transform;
      return;
    }
    const anim = el.animate(frames, { duration: travelMs, easing: 'ease-in-out', fill: 'forwards' });
    return () => anim.cancel();
  }, [m, stepMs, travelMs]);

  if (!m) return null;
  const [home, away] = result.teams;
  const leftTeam = m.attacksRight === 0 ? home : away; // the team attacking right defends the left goal
  const rightTeam = leftTeam === home ? away : home;
  const shotDelay = `${Math.round(travelMs * 0.8)}ms`;
  const selectedPlayer = selected ? result.teams.flatMap((t) => t.players).find((p) => p.id === selected) : undefined;

  return (
    <section className="pool-card">
      <div className="pool-ends">
        <span>
          <Crest team={leftTeam} size={22} /> {leftTeam.name} <span className="muted">→</span>
        </span>
        <span className="pool-status">
          <span className="pool-caption">{m.caption}</span>
          {m.shotClock !== undefined && <span className={`shot-clock${m.shotClock <= 5 ? ' low' : ''}`}>{m.shotClock}</span>}
          {m.exclusion && <span className="man-up">6 on 5 · {Math.ceil(m.exclusion.remaining)}s</span>}
        </span>
        <span>
          <span className="muted">←</span> {rightTeam.name} <Crest team={rightTeam} size={22} />
        </span>
      </div>
      <div className="pool-stage">
        <svg className="pool" viewBox={`-1.6 -0.8 ${LENGTH + 3.2} ${WIDTH + 1.6}`} role="img" aria-label="Pool view" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <defs>
            <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1f8fc9" />
              <stop offset="1" stopColor="#136fa3" />
            </linearGradient>
            <pattern id="net" width="0.3" height="0.3" patternUnits="userSpaceOnUse">
              <path d="M0 0L0.3 0.3M0.3 0L0 0.3" stroke="rgba(255,255,255,0.55)" strokeWidth="0.03" />
            </pattern>
          </defs>
          <rect x={-1.6} y={-0.8} width={LENGTH + 3.2} height={WIDTH + 1.6} fill="#0e5a86" rx={0.6} />
          <rect x={0} y={0} width={LENGTH} height={WIDTH} fill="url(#water)" />
          {[4, 8, 12, 16].map((y) => (
            <line key={y} x1={0} x2={LENGTH} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={0.08} />
          ))}
          {/* Goal lines, 2m (red), 6m (yellow) and halfway (white) */}
          {[
            { x: 0, c: '#ffffff' }, { x: LENGTH, c: '#ffffff' },
            { x: 2, c: '#e63946' }, { x: LENGTH - 2, c: '#e63946' },
            { x: 6, c: '#ffd166' }, { x: LENGTH - 6, c: '#ffd166' },
            { x: LENGTH / 2, c: '#ffffff' },
          ].map(({ x, c }) => (
            <g key={x}>
              <line x1={x} x2={x} y1={0} y2={WIDTH} stroke={c} strokeOpacity={0.35} strokeWidth={0.07} strokeDasharray={x === 0 || x === LENGTH ? undefined : '0.4 0.3'} />
              <rect x={x - 0.3} y={-0.55} width={0.6} height={0.35} fill={c} rx={0.1} />
              <rect x={x - 0.3} y={WIDTH + 0.2} width={0.6} height={0.35} fill={c} rx={0.1} />
            </g>
          ))}
          {/* Goals (3m wide); the net shakes when the ball goes in */}
          {(['left', 'right'] as const).map((side) => (
            <g key={side} className="goal-frame">
              <rect
                key={m.goalSide === side ? `hit-${index}` : side}
                className={m.goalSide === side ? 'net net-hit' : 'net'}
                style={{ animationDelay: shotDelay, transformOrigin: `${side === 'left' ? -0.45 : LENGTH + 0.45}px ${WIDTH / 2}px` }}
                x={side === 'left' ? -0.9 : LENGTH}
                y={WIDTH / 2 - 1.5}
                width={0.9}
                height={3}
                fill="url(#net)"
                stroke="#fff"
                strokeWidth={0.12}
              />
            </g>
          ))}
          {/* Re-entry corners */}
          {[0, LENGTH].map((x) => (
            <rect key={`re-${x}`} x={x === 0 ? 0 : LENGTH - 2} y={WIDTH - 0.25} width={2} height={0.25} fill="#e63946" opacity={0.7} />
          ))}

          {m.shot && (
            <line
              key={`shot-${index}`}
              className="shot-line"
              style={{ animationDelay: shotDelay, stroke: SHOT_COLORS[m.shot.outcome] }}
              x1={m.shot.from.x}
              y1={m.shot.from.y}
              x2={m.shot.to.x}
              y2={m.shot.to.y}
            />
          )}

          {m.dots.map((d) => (
            <Cap
              key={d.id}
              dot={d}
              fouls={m.fouls[d.id] ?? 0}
              energy={m.energy?.[d.id]}
              exclusionLeft={m.exclusion?.playerId === d.id ? m.exclusion.remaining : undefined}
              selected={selected === d.id}
              onSelect={() => setSelected(selected === d.id ? null : d.id)}
            />
          ))}
          <g ref={ballRef} className={`ball${m.ball.inGoal ? ' ball-in-goal' : ''}`}>
            <circle r={0.32} fill="#ffd60a" stroke="#7a5c00" strokeWidth={0.05} />
            <path d="M-0.32 0 Q0 0.15 0.32 0 M0 -0.32 Q0.13 0 0 0.32" stroke="#7a5c00" strokeWidth={0.04} fill="none" />
          </g>
        </svg>

        {m.banner && (
          <div key={`banner-${index}`} className={`pool-banner banner-${m.banner.kind}`} style={{ animationDelay: m.banner.kind === 'goal' ? shotDelay : '0ms' }}>
            {m.banner.team !== undefined && <Crest team={result.teams[m.banner.team]} size={34} />}
            <div>
              <div className="banner-title">{m.banner.title}</div>
              {m.banner.subtitle && <div className="banner-subtitle">{m.banner.subtitle}</div>}
            </div>
          </div>
        )}

        {selectedPlayer && <PlayerCard player={selectedPlayer} result={result} index={index} energy={m.energy?.[selectedPlayer.id]} onClose={() => setSelected(null)} />}
      </div>
      <div className="pool-legend muted">
        <span><svg viewBox="-0.7 -0.7 1.4 1.4" width="14" height="14"><circle r="0.52" fill={CAP_COLORS.home.fill} stroke="#999" strokeWidth="0.06" /></svg> {home.short} white caps</span>
        <span><svg viewBox="-0.7 -0.7 1.4 1.4" width="14" height="14"><circle r="0.52" fill={CAP_COLORS.away.fill} /></svg> {away.short} blue caps</span>
        <span><svg viewBox="-0.7 -0.7 1.4 1.4" width="14" height="14"><circle r="0.52" fill={CAP_COLORS.keeper.fill} /></svg> goalkeepers</span>
        <span><svg viewBox="-0.3 -0.3 0.6 0.6" width="10" height="10"><circle r="0.2" fill="#ffb703" /></svg> personal fouls</span>
        <span><svg viewBox="0 0 1 0.3" width="16" height="6"><rect width="1" height="0.3" rx="0.15" fill="hsl(80 75% 48%)" /></svg> energy</span>
        <span>Tap a cap for player stats</span>
      </div>
    </section>
  );
}

function PlayerCard({ player, result, index, energy, onClose }: { player: Player; result: MatchResult; index: number; energy?: number; onClose: () => void }) {
  const s = liveStats(result, player.id, index);
  const team = result.teams.find((t) => t.players.includes(player))!;
  const a = player.attrs;
  const attrs: [string, number][] =
    player.position === 'GK'
      ? [['Reflexes', a.reflexes], ['Positioning', a.gkPositioning], ['Legs', a.legStrength], ['Game IQ', a.gameIQ]]
      : [['Speed', a.speed], ['Shot power', a.shootingPower], ['Accuracy', a.shootingAccuracy], ['Passing', a.passing], ['Wrestling', a.wrestling], ['Defending', a.positioning]];
  return (
    <div className="player-card" role="dialog" aria-label={player.name}>
      <button className="player-card-close" onClick={onClose} aria-label="Close">×</button>
      <div className="player-card-head">
        <Crest team={team} size={28} />
        <div>
          <div className="player-card-name">#{player.cap} {player.name}</div>
          <div className="muted small">{player.position} · {player.hand === 'L' ? 'left' : 'right'}-handed · age {player.age} · overall {overall(player).toFixed(1)}</div>
        </div>
      </div>
      <div className="player-card-stats">
        {player.position === 'GK' ? (
          <span>Saves <b>{s.saves}</b></span>
        ) : (
          <>
            <span>Goals <b>{s.goals}/{s.shots}</b></span>
            <span>Assists <b>{s.assists}</b></span>
            <span>Exclusions drawn <b>{s.exclusionsDrawn}</b></span>
            <span>Steals <b>{s.steals}</b></span>
          </>
        )}
        <span>Fouls <b className={s.fouls >= 2 ? 'warn' : ''}>{s.fouls}/3</b></span>
        {energy !== undefined && <span>Energy <b className={energy < 50 ? 'warn' : ''}>{energy}%</b></span>}
      </div>
      <div className="player-card-attrs">
        {attrs.map(([label, v]) => (
          <div key={label} className="attr-row">
            <span>{label}</span>
            <span className="attr-bar"><span style={{ width: `${(v / 20) * 100}%` }} /></span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
