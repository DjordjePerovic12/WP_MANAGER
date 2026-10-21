import { useState } from 'react';
import { useLeague } from './api';
import { CareerView } from './career/CareerView';
import { FriendlyView } from './FriendlyView';

type View = 'career' | 'friendly';

export function App() {
  const league = useLeague();
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem('wpm.view') as View) || 'career';
    } catch {
      return 'career';
    }
  });
  const go = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('wpm.view', v);
    } catch {
      /* storage unavailable: fine */
    }
  };

  return (
    <main>
      <header className="app-header">
        <div>
          <h1>Water Polo Manager</h1>
          <p className="muted">
            {league?.source === 'real' ? 'Real clubs, 2026-27 season' : league ? 'Fictional clubs (start the API with npm run server for real ones)' : 'Loading clubs…'}
          </p>
        </div>
        <nav className="tabs">
          <button className={view === 'career' ? 'active' : ''} onClick={() => go('career')}>
            Career
          </button>
          <button className={view === 'friendly' ? 'active' : ''} onClick={() => go('friendly')}>
            Friendly match
          </button>
        </nav>
      </header>
      {league && (view === 'career' ? <CareerView league={league} /> : <FriendlyView league={league} />)}
    </main>
  );
}
