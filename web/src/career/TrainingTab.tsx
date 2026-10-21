import { useState } from 'react';
import type { Player } from '../../../engine';
import {
  ATTRIBUTE_LABELS,
  FOCUS_ATTRIBUTES,
  FOCUS_LABELS,
  focusAttributes,
  INDIVIDUAL_LABELS,
  PERSONALITY_HELP,
  PERSONALITY_LABELS,
  personalityOf,
  setIndividualFocus,
  setTraining,
  type CareerState,
  type IndividualFocus,
  type TrainingEntry,
  type TrainingFocus,
  type TrainingIntensity,
} from '../../../game';
import { PlayerProfile } from './HistoryTab';
import { Fitness } from './SquadTab';

const FOCUS_HELP: Record<TrainingFocus, string> = {
  balanced: 'A little of everything.',
  shooting: 'Shot power and accuracy.',
  swimming: 'Speed and stamina: more counters, fresher in the 4th quarter.',
  defence: 'Defending, wrestling and legs: the battle at 2m.',
  powerplay: 'Passing, accuracy and game IQ for the 6 on 5.',
  recovery: 'No skill work: players recover much more fitness.',
};

const INTENSITY_HELP: Record<TrainingIntensity, string> = {
  light: 'Fresh legs, slow progress, almost no injuries.',
  normal: 'A sensible balance.',
  hard: 'Fastest progress, but players stay tired and get hurt more often.',
};

const SHORT_LABELS: Record<keyof Player['attrs'], string> = {
  speed: 'Speed', stamina: 'Stam.', shootingPower: 'Power', shootingAccuracy: 'Acc.', passing: 'Pass', legStrength: 'Legs',
  wrestling: 'Wrest.', positioning: 'Def.', gameIQ: 'IQ', reflexes: 'Refl.', gkPositioning: 'GK pos',
};

const FIELD_OPTIONS: IndividualFocus[] = ['team', 'shooting', 'swimming', 'defence', 'powerplay', 'rest'];
const KEEPER_OPTIONS: IndividualFocus[] = ['team', 'goalkeeping', 'swimming', 'rest'];

function RatingBadge({ entry }: { entry?: TrainingEntry }) {
  if (!entry) return <span className="muted small">–</span>;
  if (entry.rating === undefined) return <span className={`rating rating-${entry.tone}`}>{entry.tone === 'injured' ? '🩹' : 'Rest'}</span>;
  return <span className={`rating rating-${entry.tone}`}>{entry.rating.toFixed(1)}</span>;
}

/** Recent training ratings as small bars (oldest left). */
function Trend({ ratings }: { ratings: number[] }) {
  if (!ratings.length) return <span className="muted small">–</span>;
  return (
    <span className="trend" title={`Last ${ratings.length} weeks: ${ratings.join(', ')}`}>
      {ratings.map((r, i) => (
        <span key={i} style={{ height: `${Math.max(10, r * 10)}%`, background: r >= 8 ? '#2a9d5c' : r >= 6.5 ? 'var(--accent)' : r >= 5 ? '#8a96a3' : '#c0392b' }} />
      ))}
    </span>
  );
}

export function TrainingTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const t = career.training;
  const club = career.teams.find((x) => x.id === career.managedClubId)!;
  const report = career.trainingReport;
  const entries = new Map(report?.entries.map((e) => [e.playerId, e]) ?? []);
  const [sort, setSort] = useState<'position' | 'rating'>('position');
  const [profile, setProfile] = useState<Player | null>(null);

  const players = [...club.players].sort((a, b) =>
    sort === 'rating'
      ? (entries.get(b.id)?.rating ?? -1) - (entries.get(a.id)?.rating ?? -1)
      : Number(b.position === 'GK') - Number(a.position === 'GK') || a.cap - b.cap,
  );
  const rated = report?.entries.filter((e) => e.rating !== undefined) ?? [];
  const best = rated.reduce<TrainingEntry | undefined>((a, e) => (!a || e.rating! > a.rating! ? e : a), undefined);
  const worst = rated.reduce<TrainingEntry | undefined>((a, e) => (!a || e.rating! < a.rating! ? e : a), undefined);
  const gains = report?.entries.flatMap((e) => e.gains.map((g) => ({ e, g }))) ?? [];
  const name = (id: string) => club.players.find((p) => p.id === id)?.name ?? '';
  const avgFitness = Math.round(club.players.reduce((s, p) => s + (career.squad[p.id]?.condition ?? 100), 0) / club.players.length);

  return (
    <div className="training">
      <div className="career-grid">
        <div className="card">
          <h3>Team plan</h3>
          <div className="choice-grid">
            {(Object.keys(FOCUS_LABELS) as TrainingFocus[]).map((f) => (
              <button key={f} className={`choice${t.focus === f ? ' selected' : ''}`} onClick={() => onChange(setTraining(career, { ...t, focus: f }))}>
                <b>{FOCUS_LABELS[f]}</b>
                <span className="muted small">{FOCUS_HELP[f]}</span>
                {f !== 'recovery' && f !== 'balanced' && <span className="small">{FOCUS_ATTRIBUTES[f].map((a) => ATTRIBUTE_LABELS[a]).join(' · ')}</span>}
              </button>
            ))}
          </div>
          <h4>Intensity</h4>
          <div className="choice-grid three">
            {(['light', 'normal', 'hard'] as TrainingIntensity[]).map((i) => (
              <button key={i} className={`choice${t.intensity === i ? ' selected' : ''}`} onClick={() => onChange(setTraining(career, { ...t, intensity: i }))}>
                <b>{i[0].toUpperCase() + i.slice(1)}</b>
                <span className="muted small">{INTENSITY_HELP[i]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>{report ? `Training report · week ${report.round}` : 'Training report'}</h3>
          {!report && <p className="muted">The first report comes after the first round.</p>}
          {report && (
            <div className="report-highlights">
              {best && (
                <div>
                  <span className="muted small">Player of the week</span>
                  <b>
                    {name(best.playerId)} <span className="rating rating-great">{best.rating!.toFixed(1)}</span>
                  </b>
                  <span className="small">{best.note}</span>
                </div>
              )}
              {worst && worst !== best && (
                <div>
                  <span className="muted small">Needs a word</span>
                  <b>
                    {name(worst.playerId)} <span className={`rating rating-${worst.tone}`}>{worst.rating!.toFixed(1)}</span>
                  </b>
                  <span className="small">{worst.note}</span>
                </div>
              )}
              <div>
                <span className="muted small">Improved this week</span>
                {gains.length === 0 ? (
                  <span className="small muted">No attribute went up this week.</span>
                ) : (
                  gains.map(({ e, g }) => (
                    <span key={`${e.playerId}-${g}`} className="small up">
                      ▲ {name(e.playerId)}: {ATTRIBUTE_LABELS[g]}
                    </span>
                  ))
                )}
              </div>
              <div>
                <span className="muted small">Squad fitness</span>
                <b>
                  {avgFitness}% <Fitness value={avgFitness} />
                </b>
                <span className="small">Morale {career.morale[club.id] ?? 60}/100</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="squad-head">
          <div>
            <h3>Players</h3>
            <p className="muted small">Give anyone a personal focus, or rest a tired player. Ratings 1–10: better weeks mean faster progress. Bars show progress toward the next point.</p>
          </div>
          <div className="squad-summary">
            <span className="muted small">Sort</span>
            <button className={sort === 'position' ? 'active-sort' : ''} onClick={() => setSort('position')}>
              Position
            </button>
            <button className={sort === 'rating' ? 'active-sort' : ''} onClick={() => setSort('rating')}>
              This week
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="squad-table training-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Pos</th>
                <th>Age</th>
                <th>Personality</th>
                <th>Focus</th>
                <th>Week</th>
                <th>Form</th>
                <th>Progress</th>
                <th>How it went</th>
                <th>Fitness</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const entry = entries.get(p.id);
                const personality = personalityOf(career.seed, p.id);
                const own = career.individual[p.id] ?? 'team';
                const attrs = focusAttributes(p, t, own);
                const prog = career.progress[p.id] ?? {};
                const cond = career.squad[p.id] ?? { condition: 100 };
                return (
                  <tr key={p.id} className={cond.injury ? 'injured' : ''}>
                    <td>{p.cap}</td>
                    <td>
                      <button className="link" onClick={() => setProfile(p)}>
                        {p.name}
                      </button>
                    </td>
                    <td>{p.position}</td>
                    <td>{p.age}</td>
                    <td>
                      <span className={`personality personality-${personality}`} title={PERSONALITY_HELP[personality]}>
                        {PERSONALITY_LABELS[personality]}
                      </span>
                    </td>
                    <td>
                      <select value={own} onChange={(e) => onChange(setIndividualFocus(career, p.id, e.target.value as IndividualFocus))} aria-label={`Training focus for ${p.name}`}>
                        {(p.position === 'GK' ? KEEPER_OPTIONS : FIELD_OPTIONS).map((o) => (
                          <option key={o} value={o}>
                            {o === 'team' ? `Team plan (${FOCUS_LABELS[t.focus]})` : INDIVIDUAL_LABELS[o]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <RatingBadge entry={entry} />
                    </td>
                    <td>
                      <Trend ratings={career.trainingRatings[p.id] ?? []} />
                    </td>
                    <td className="progress-cell">
                      {attrs.length === 0 && <span className="muted small">–</span>}
                      {attrs.slice(0, 3).map((a) => (
                        <span key={a} className="mini-progress" title={`${ATTRIBUTE_LABELS[a]} ${p.attrs[a]} → ${p.attrs[a] + 1}: ${Math.round((prog[a] ?? 0) * 100)}%`}>
                          <span className="mini-label">{SHORT_LABELS[a]}</span>
                          <span className="mini-bar">
                            <span style={{ width: `${Math.min(100, (prog[a] ?? 0) * 100)}%` }} />
                          </span>
                        </span>
                      ))}
                      {attrs.length > 3 && <span className="muted small">+{attrs.length - 3}</span>}
                    </td>
                    <td className="note-cell">
                      {entry?.gains.length ? <span className="up">▲ {entry.gains.map((g) => ATTRIBUTE_LABELS[g]).join(', ')} · </span> : null}
                      <span className={entry?.tone === 'poor' ? 'warn-text' : ''}>{entry?.note ?? <span className="muted">–</span>}</span>
                    </td>
                    <td>
                      <Fitness value={cond.condition} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <NewsFeed career={career} limit={14} />
      {profile && <PlayerProfile career={career} player={club.players.find((x) => x.id === profile.id) ?? profile} onClose={() => setProfile(null)} />}
    </div>
  );
}

export function NewsFeed({ career, limit = 8 }: { career: CareerState; limit?: number }) {
  const items = career.news.slice(-limit).reverse();
  const icon = { injury: '🩹', recovered: '✅', training: '📈', result: '🏁' };
  return (
    <div className="card news">
      <h3>News</h3>
      {items.length === 0 && <p className="muted">Nothing yet: play the first round.</p>}
      {items.map((n, i) => (
        <div key={i} className={`news-item news-${n.kind}`}>
          <span aria-hidden>{icon[n.kind]}</span>
          <span>
            <span className="muted small">{n.round ? `R${n.round} ` : 'Summer '}</span>
            {n.text}
          </span>
        </div>
      ))}
    </div>
  );
}
