import { makeSchedule } from './game';
for (const n of [8, 12, 13]) {
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  let worst = 0, breaks = 0;
  for (let seed = 1; seed < 30; seed++) {
    const f = makeSchedule(ids, seed);
    for (const id of ids) {
      const seq = f.filter((x) => x.homeId === id || x.awayId === id).sort((a, b) => a.round - b.round).map((x) => (x.homeId === id ? 'H' : 'A'));
      let run = 1;
      for (let i = 1; i < seq.length; i++) { run = seq[i] === seq[i - 1] ? run + 1 : 1; worst = Math.max(worst, run); if (seq[i] === seq[i - 1]) breaks++; }
    }
  }
  console.log(n, 'clubs: longest home/away streak', worst, 'avg breaks per club', (breaks / 29 / n).toFixed(1));
}
