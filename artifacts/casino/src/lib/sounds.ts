let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function master(ac: AudioContext) {
  const g = ac.createGain();
  g.gain.value = 0.13;
  g.connect(ac.destination);
  return g;
}

function osc(ac: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, gainVal: number, dest: AudioNode, freqEnd?: number) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
  g.gain.setValueAtTime(gainVal, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(dest);
  o.start(start);
  o.stop(start + dur + 0.01);
}

function noise(ac: AudioContext, dur: number, gainVal: number, filterFreq: number, dest: AudioNode) {
  const bufSize = ac.sampleRate * dur;
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filt = ac.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = filterFreq;
  filt.Q.value = 2;
  const g = ac.createGain();
  g.gain.setValueAtTime(gainVal, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(dest);
  src.start();
  src.stop(ac.currentTime + dur);
}

export type SoundName =
  | "chip"
  | "deal"
  | "win"
  | "lose"
  | "jackpot"
  | "spinStart"
  | "slotStop"
  | "rouletteClick"
  | "buttonClick"
  | "fold"
  | "check"
  | "raise"
  | "yourTurn"
  | "newCard"
  | "cardFlip"
  | "streakWin"
  | "cashOut"
  | "mineSafe"
  | "mineBust"
  | "kenoTick"
  | "kenoHit";

export function playSound(name: SoundName) {
  try {
    const ac = getCtx();
    const now = ac.currentTime;
    const m = master(ac);

    switch (name) {
      case "chip": {
        osc(ac, "sine", 900, now, 0.08, 0.6, m);
        osc(ac, "triangle", 1400, now, 0.04, 0.3, m);
        noise(ac, 0.05, 0.15, 3000, m);
        break;
      }

      case "deal": {
        noise(ac, 0.09, 0.4, 2200, m);
        osc(ac, "sine", 320, now, 0.08, 0.2, m, 180);
        break;
      }

      case "win": {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => {
          osc(ac, "triangle", f, now + i * 0.1, 0.25, 0.5, m);
          osc(ac, "sine", f * 2, now + i * 0.1, 0.18, 0.15, m);
        });
        break;
      }

      case "lose": {
        osc(ac, "sawtooth", 220, now, 0.15, 0.4, m, 100);
        osc(ac, "square", 110, now + 0.05, 0.25, 0.3, m, 60);
        noise(ac, 0.18, 0.1, 150, m);
        break;
      }

      case "jackpot": {
        const melody = [523, 659, 784, 659, 784, 1047, 1319, 1047, 1319, 1568];
        melody.forEach((f, i) => {
          osc(ac, "triangle", f, now + i * 0.09, 0.22, 0.6, m);
          if (i % 2 === 0) osc(ac, "sine", f * 1.5, now + i * 0.09, 0.15, 0.2, m);
        });
        break;
      }

      case "spinStart": {
        osc(ac, "sawtooth", 60, now, 0.4, 0.3, m, 200);
        osc(ac, "sine", 80, now, 0.4, 0.35, m, 250);
        noise(ac, 0.35, 0.15, 600, m);
        break;
      }

      case "slotStop": {
        osc(ac, "square", 160, now, 0.07, 0.5, m, 80);
        noise(ac, 0.06, 0.25, 400, m);
        break;
      }

      case "rouletteClick": {
        osc(ac, "sine", 700, now, 0.05, 0.4, m, 500);
        noise(ac, 0.04, 0.1, 2000, m);
        break;
      }

      case "buttonClick": {
        osc(ac, "sine", 600, now, 0.04, 0.25, m);
        break;
      }

      case "fold": {
        noise(ac, 0.12, 0.35, 800, m);
        osc(ac, "sine", 320, now, 0.2, 0.25, m, 150);
        break;
      }

      case "check": {
        osc(ac, "sine", 500, now, 0.07, 0.28, m, 380);
        noise(ac, 0.06, 0.12, 1200, m);
        break;
      }

      case "raise": {
        osc(ac, "triangle", 700, now, 0.06, 0.3, m);
        osc(ac, "triangle", 1050, now + 0.07, 0.06, 0.28, m);
        noise(ac, 0.05, 0.1, 2500, m);
        break;
      }

      case "yourTurn": {
        osc(ac, "sine", 660, now, 0.35, 0.38, m);
        osc(ac, "sine", 880, now + 0.18, 0.35, 0.38, m);
        osc(ac, "triangle", 1100, now + 0.36, 0.25, 0.3, m);
        break;
      }

      case "newCard": {
        noise(ac, 0.06, 0.3, 1800, m);
        osc(ac, "sine", 280, now, 0.06, 0.18, m, 200);
        break;
      }

      case "cardFlip": {
        // papery whoosh spanning the full flip duration (~175ms)
        noise(ac, 0.17, 0.45, 1800, m);
        osc(ac, "sine", 380, now, 0.07, 0.17, m, 560);
        break;
      }

      case "streakWin": {
        // two-note rising ding — confirms each correct guess
        osc(ac, "triangle", 660, now, 0.13, 0.38, m);
        osc(ac, "sine",     660, now, 0.06, 0.18, m);
        osc(ac, "triangle", 880, now + 0.11, 0.13, 0.32, m);
        osc(ac, "sine",     880, now + 0.11, 0.06, 0.18, m);
        break;
      }

      case "cashOut": {
        // ascending 3-note fanfare + coin shimmer
        const cashNotes = [523, 784, 1047, 1568];
        cashNotes.forEach((f, i) => {
          osc(ac, "triangle", f, now + i * 0.11, 0.28, 0.5, m);
          osc(ac, "sine", f * 2, now + i * 0.11, 0.1, 0.18, m);
        });
        noise(ac, 0.55, 0.08, 4000, m);
        break;
      }

      case "mineSafe": {
        // crisp cash rustle + register ding
        noise(ac, 0.18, 0.22, 2200, m);
        osc(ac, "triangle", 1320, now + 0.04, 0.12, 0.14, m);
        osc(ac, "sine", 2200, now + 0.08, 0.06, 0.08, m);
        break;
      }

      case "mineBust": {
        // Police siren wail — two alternating sweeping tones
        osc(ac, "sawtooth", 880, now,       0.35, 0.35, m, 620);
        osc(ac, "sawtooth", 620, now + 0.35, 0.35, 0.35, m, 880);
        osc(ac, "sine",     880, now,       0.12, 0.25, m, 620);
        noise(ac, 0.18, 0.1, 600, m);
        break;
      }

      case "kenoTick": {
        // Soft lottery-ball blip for each number drawn
        osc(ac, "sine", 750, now, 0.035, 0.10, m, 550);
        noise(ac, 0.04, 0.05, 2500, m);
        break;
      }

      case "kenoHit": {
        // Bright casino ding when a picked number is revealed
        osc(ac, "triangle", 1320, now, 0.18, 0.20, m);
        osc(ac, "sine",     1320, now, 0.08, 0.14, m);
        osc(ac, "triangle", 1980, now + 0.08, 0.12, 0.18, m);
        noise(ac, 0.05, 0.07, 3500, m);
        break;
      }
    }
  } catch {
  }
}
