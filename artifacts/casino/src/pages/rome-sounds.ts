// Rome Slots — Web Audio API sound engine
import buttonClickUrl from "@assets/buttonclick_1777322204907.mp3";

let ac: AudioContext | null = null;

// Decoded AudioBuffer — ready to play
let clickBuffer: AudioBuffer | null = null;
// Raw bytes fetched eagerly at module load (no AudioContext required)
let rawClickBytes: ArrayBuffer | null = null;

// Start fetching immediately when this module is imported
fetch(buttonClickUrl)
  .then(r => r.arrayBuffer())
  .then(arr => { rawClickBytes = arr; })
  .catch(() => {});

let masterVolume = parseFloat(localStorage.getItem("fortuna-sfx-volume") ?? "1");
let masterMuted  = localStorage.getItem("fortuna-sfx-muted") === "true";

export function setRomeSfxVolume(v: number) {
  masterVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem("fortuna-sfx-volume", String(masterVolume));
}
export function setRomeSfxMuted(m: boolean) {
  masterMuted = m;
  localStorage.setItem("fortuna-sfx-muted", String(m));
}
export function getRomeSfxVolume() { return masterVolume; }
export function getRomeSfxMuted()  { return masterMuted; }

function getCtx(): AudioContext {
  if (!ac || ac.state === "closed") {
    ac = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Decode the already-fetched bytes — decoding is ~1ms vs ~300ms for a fetch
    if (rawClickBytes && !clickBuffer) {
      ac.decodeAudioData(rawClickBytes.slice(0))
        .then(buf => { clickBuffer = buf; })
        .catch(() => {});
    }
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

function playOsc(
  freq: number,
  startSec: number,
  dur: number,
  vol: number,
  type: OscillatorType = "sine",
  freqEnd?: number
) {
  if (masterMuted || masterVolume === 0) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  const t0 = ctx.currentTime + startSec;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  const v = vol * masterVolume;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(v, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function playNoise(startSec: number, dur: number, vol: number, freqCenter: number, q = 1) {
  if (masterMuted || masterVolume === 0) return;
  const ctx = getCtx();
  const samples = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = freqCenter;
  filt.Q.value = q;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + startSec;
  const v = vol * masterVolume;
  gain.gain.setValueAtTime(v, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt);
  filt.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

// ── Spin button press (MP3) ───────────────────────────────────────────────────
export function playSpinClick() {
  if (masterMuted || masterVolume === 0) return;
  const ctx = getCtx();

  const doPlay = (buf: AudioBuffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.55 * masterVolume;
    src.connect(gain).connect(ctx.destination);
    src.start(ctx.currentTime);
  };

  if (clickBuffer) {
    doPlay(clickBuffer);
  } else if (rawClickBytes) {
    // Bytes already fetched — decode on-demand (~1ms) and play immediately after
    ctx.decodeAudioData(rawClickBytes.slice(0))
      .then(buf => { clickBuffer = buf; doPlay(buf); })
      .catch(() => {});
  }
  // If neither is ready yet: silent click (better than a double/delayed sound)
}

// ── Single reel row-crossing tick (call once per symbol boundary crossed) ────
// Rate is driven by the reel animation loop — naturally decelerates with reels.
export function playReelTick() {
  playNoise(0, 0.016, 0.10, 450, 3);
}

// ── Individual reel stops (call once per reel landing) ───────────────────────
// Firm clack + warm bronze chink — ~250 ms, Roman-themed
export function playReelStop() {
  // Mechanical clack: low-mid noise
  playNoise(0,     0.070, 0.22, 175, 2.0);
  // Body: low square sweep
  playOsc(100, 0, 0.10, 0.11, "square", 60);
  // Bronze chink: warm fundamental
  playOsc(660, 0.032, 0.20, 0.10, "sine",     480);
  // Chink shimmer: soft overtone
  playOsc(1320, 0.04,  0.12, 0.04, "triangle", 960);
}

// ── Win sounds ───────────────────────────────────────────────────────────────
// Small win: quick 4-note coin arpeggio
export function playSmallWin() {
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    playOsc(f, i * 0.09, 0.22, 0.28, "sine");
    playOsc(f * 2, i * 0.09 + 0.01, 0.08, 0.08, "triangle");
  });
}

// Huge win: cascading coins + closing chord
export function playHugeWin() {
  const notes = [523, 659, 784, 988, 1047, 1319];
  notes.forEach((f, i) => {
    playOsc(f, i * 0.07, 0.28, 0.32, "sine");
    playOsc(f * 1.5, i * 0.07 + 0.01, 0.12, 0.10, "triangle");
  });
  // Triumphant chord
  [523, 659, 784, 1047].forEach(f => playOsc(f, 0.55, 0.9, 0.22, "sine"));
}

// Mega win: huge win + higher register echo
export function playMegaWin() {
  playHugeWin();
  [1047, 1319, 1568, 2093].forEach((f, i) =>
    playOsc(f, 0.65 + i * 0.09, 0.35, 0.26, "sine")
  );
}

// Jackpot: full fanfare melody + coin rain
export function playJackpot() {
  const fanfare: [number, number][] = [
    [523, 0], [523, 0.1], [523, 0.2], [659, 0.32], [784, 0.52],
    [784, 0.72], [784, 0.9], [988, 1.1], [1047, 1.35],
  ];
  fanfare.forEach(([f, t]) => {
    playOsc(f, t, 0.28, 0.38, "sine");
    playOsc(f * 1.25, t + 0.01, 0.22, 0.13, "triangle");
  });
  // Coin shower
  for (let i = 0; i < 10; i++) {
    const f = 700 + Math.random() * 600;
    playOsc(f, i * 0.06, 0.18, 0.12, "sine");
    playNoise(i * 0.06, 0.04, 0.06, 1200, 4);
  }
  // Final big chord
  [523, 659, 784, 988, 1047].forEach(f => playOsc(f, 1.55, 1.2, 0.20, "sine"));
}
