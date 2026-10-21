// Match sounds, synthesized with the Web Audio API (no audio files needed).

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a click handler so the browser allows sound later. */
export function unlockAudio() {
  audio();
}

/** Referee's whistle: a high trilling tone. */
export function whistle(length = 0.45) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const trill = a.createOscillator();
  const trillGain = a.createGain();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = 2900;
  trill.frequency.value = 28;
  trillGain.gain.value = 140;
  trill.connect(trillGain).connect(osc.frequency);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
  gain.gain.setValueAtTime(0.12, t + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, t + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  trill.start(t);
  osc.stop(t + length);
  trill.stop(t + length);
}

/** Crowd roar: filtered noise that swells and fades. */
export function crowd(strength = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const seconds = 2.2;
  const buffer = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = a.createBufferSource();
  noise.buffer = buffer;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 0.6;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.22 * strength, t + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
  noise.connect(band).connect(gain).connect(a.destination);
  noise.start(t);
}

/** The horn at the end of a quarter. */
export function horn() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.08, t + 0.05);
  gain.gain.setValueAtTime(0.08, t + 0.9);
  gain.gain.linearRampToValueAtTime(0, t + 1.1);
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  for (const f of [220, 277]) {
    const osc = a.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + 1.1);
  }
  filter.connect(gain).connect(a.destination);
}
