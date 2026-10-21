import { FOCUS_ATTRIBUTES, FOCUS_LABELS, setTraining, ATTRIBUTE_LABELS, type CareerState, type TrainingFocus, type TrainingIntensity } from '../../../game';
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

export function TrainingTab({ career, onChange }: { career: CareerState; onChange: (c: CareerState) => void }) {
  const t = career.training;
  const club = career.teams.find((x) => x.id === career.managedClubId)!;
  const avgFitness = Math.round(club.players.reduce((s, p) => s + (career.squad[p.id]?.condition ?? 100), 0) / club.players.length);
  const injured = club.players.filter((p) => career.squad[p.id]?.injury);
  return (
    <div className="career-grid">
      <div className="card">
        <h3>Weekly training</h3>
        <p className="muted small">Training happens between rounds. Attributes improve slowly (young players fastest); goalkeepers always work on their own skills.</p>
        <h4>Focus</h4>
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
        <h3>Squad condition</h3>
        <p>
          Average fitness <b>{avgFitness}%</b> <Fitness value={avgFitness} />
        </p>
        <p>
          Morale <b>{career.morale[club.id] ?? 60}</b>/100
        </p>
        <h4>Injured ({injured.length})</h4>
        {injured.length === 0 && <p className="muted">Nobody is injured.</p>}
        {injured.map((p) => (
          <div key={p.id} className="injury-row">
            <span>
              #{p.cap} {p.name}
            </span>
            <span className="injury-tag">
              {career.squad[p.id].injury!.name} · {career.squad[p.id].injury!.weeksLeft}w
            </span>
          </div>
        ))}
      </div>
      <NewsFeed career={career} limit={20} />
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
            <span className="muted small">R{n.round} </span>
            {n.text}
          </span>
        </div>
      ))}
    </div>
  );
}
