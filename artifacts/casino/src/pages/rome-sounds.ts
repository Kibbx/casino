// Rome Slots — Web Audio API sound engine
import buttonClickUrl    from "@assets/buttonclick_1777322204907.mp3";
import bonusMusicUrl     from "@assets/onecinematicstudio-the-great-arena-_-epic-roman-gladiator-batt_1784861486450.mp3";

let ac: AudioContext | null = null;

// Decoded AudioBuffer — ready to play
let clickBuffer: AudioBuffer | null = null;
// Raw bytes fetched eagerly at module load (no AudioContext required)
let rawClickBytes: ArrayBuffer | null = null;

// Bonus round background music (decoded + open AudioBufferSource so we can loop)
let bonusBuffer: AudioBuffer | null = null;
let rawBonusBytes: ArrayBuffer | null = null;
let bonusSource: AudioBufferSourceNode | null = null;
let bonusGain: GainNode | null = null;

// Start fetching immediately when this module is imported
fetch(buttonClickUrl)
  .then(r => r.arrayBuffer())
  .then(arr => { rawClickBytes = arr; })
  .catch(() => {});

fetch(bonusMusicUrl)
  .then(r => r.arrayBuffer())
  .then(arr => { rawBonusBytes = arr; })
  .catch(e => console.warn("[rome-sounds] bonus music fetch failed:", e));

// Bonus music sits at 10% of the master volume so it's ambient, not overpowering
const BONUS_BASE_VOL = 0.10;

// Master attenuation — every slot sound is scaled by this so the mix stays balanced.
const SLOTS_GAIN_SCALE = 0.5;

let masterVolume = parseFloat(localStorage.getItem("fortuna-sfx-volume") ?? "1") * SLOTS_GAIN_SCALE;
let masterMuted  = localStorage.getItem("fortuna-sfx-muted") === "true";

function bonusTargetGain() {
  return masterMuted ? 0 : BONUS_BASE_VOL * masterVolume;
}

export function setRomeSfxVolume(v: number) {
  masterVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem("fortuna-sfx-volume", String(masterVolume));
  // Live-update bonus music gain — bonusGain stays alive while music plays
  if (bonusGain) bonusGain.gain.setTargetAtTime(bonusTargetGain(), bonusGain.context.currentTime, 0.05);
}
export function setRomeSfxMuted(m: boolean) {
  masterMuted = m;
  localStorage.setItem("fortuna-sfx-muted", String(m));
  // Mute/unmute by ramping gain to 0 or back — never stop the source so bonusGain stays valid
  if (bonusGain) bonusGain.gain.setTargetAtTime(bonusTargetGain(), bonusGain.context.currentTime, 0.05);
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
    if (rawBonusBytes && !bonusBuffer) {
      ac.decodeAudioData(rawBonusBytes.slice(0))
        .then(buf => { bonusBuffer = buf; })
        .catch(e => console.warn("[rome-sounds] bonus decode failed:", e));
    }
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

// ── Bonus round background music (Web Audio, loops natively) ─────────────────
export function playBonusMusic() {
  if (masterMuted || masterVolume === 0) return;
  // Already playing — no-op so we don't restart from frame zero mid-round
  if (bonusSource && bonusGain) {
    if (bonusSource.context.state === "suspended") bonusSource.context.resume().catch(() => {});
    console.log("[rome-sounds] bonus music already playing");
    return;
  }
  const ctx = getCtx();
  console.log("[rome-sounds] playBonusMusic ctx.state=", ctx.state, "muted=", masterMuted, "vol=", masterVolume);
  const play = (buf: AudioBuffer) => {
    try {
      // Force resume on each play in case context was paused by the browser
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      src.loop   = true;
      const gain = ctx.createGain();
      gain.gain.value = bonusTargetGain();
      src.connect(gain).connect(ctx.destination);
      src.start(0);
      bonusSource = src;
      bonusGain   = gain;
      console.log("[rome-sounds] bonus music started, dur=", buf.duration.toFixed(2), "s");
    } catch (e) { console.warn("[rome-sounds] playBonusMusic error:", e); }
  };
  if (bonusBuffer) { play(bonusBuffer); return; }
  if (rawBonusBytes) {
    ctx.decodeAudioData(rawBonusBytes.slice(0))
      .then(buf => { bonusBuffer = buf; play(buf); })
      .catch(e => console.warn("[rome-sounds] bonus decode-on-play failed:", e));
  } else {
    // Bytes not loaded yet — fetch + decode inline
    fetch(bonusMusicUrl).then(r => r.arrayBuffer()).then(arr => {
      rawBonusBytes = arr;
      decodeAudioData(arr.slice(0)).then(buf => { bonusBuffer = buf; play(buf); }).catch(e => console.warn("[rome-sounds] bonus inline decode failed:", e));
    }).catch(e => console.warn("[rome-sounds] bonus inline fetch failed:", e));
  }
}

export function stopBonusMusic() {
  if (!bonusSource) return;
  try { bonusSource.stop(); } catch {}
  try { bonusSource.disconnect(); bonusGain?.disconnect(); } catch {}
  bonusSource = null;
  bonusGain = null;
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

// ── Scatter symbol lands (columns 0-2) ───────────────────────────────────────
// Layered impact: sub punch + stone thud body + mid crack + metallic shimmer ring
export function playScatterLand() {
  // Sub punch: deep sine plunge — the weight of something heavy hitting stone
  playOsc(95,   0,      0.18,  0.38, "sine",     28);
  // Stone thud body: low-mid noise burst — dense impact mass
  playNoise(0,  0.07,   0.42,  120,  1.2);
  // Mid crack transient: tight bandpass snap on contact
  playNoise(0,  0.030,  0.32,  520,  3.0);
  // Upper crack: adds definition and sharpness to the hit
  playNoise(0,  0.018,  0.18, 1400,  4.5);
  // Metallic shimmer: sustained ring that makes it feel special / coin-like
  playOsc(1760, 0.004,  0.55,  0.09, "sine");
  playOsc(2640, 0.006,  0.40,  0.05, "sine");
  // Bright top shimmer: airy sparkle tail
  playOsc(4200, 0.008,  0.28,  0.04, "triangle");
}

// ── Single reel row-crossing tick (call once per symbol boundary crossed) ────
// Rate is driven by the reel animation loop — naturally decelerates with reels.
export function playReelTick() {
  playNoise(0, 0.016, 0.20, 450, 3);
}

// ── Individual reel stops (call once per reel landing) ───────────────────────
// Massive wooden block drop — deep sub thump + heavy wood crack
export function playReelStop() {
  // Deep low thump: heavy low noise for block mass
  playNoise(0,    0.095, 0.40, 140, 1.4);
  // Sub-bass body: deep sine plunge (the "weight" of the block)
  playOsc(62,  0,    0.16, 0.24, "sine",   26);
  // Mid wood body: secondary resonance layer
  playNoise(0,    0.050, 0.22, 340, 2.8);
  // Impact transient: heavy square crack on contact
  playOsc(280, 0,    0.042, 0.14, "square", 130);
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
