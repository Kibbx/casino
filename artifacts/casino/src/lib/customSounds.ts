/**
 * customSounds.ts — Drop zone for custom audio files.
 *
 * HOW TO ADD A SOUND
 * ──────────────────
 * 1. Copy your audio file (.mp3 or .wav) into:
 *      artifacts/casino/public/sounds/
 *
 * 2. Add one line to the CUSTOM_SOUNDS map below:
 *      "mySound": "/sounds/my-file.mp3",
 *
 * 3. Call it anywhere in the app:
 *      import { playCustomSound } from "../lib/customSounds";
 *      playCustomSound("mySound");
 *
 * Notes:
 *  • Each file is decoded once and cached — no lag on repeat plays.
 *  • Volume follows the master gain in sounds.ts automatically.
 *  • Use .mp3 for best compatibility with FiveM's CEF browser.
 */

/* ─────────────────────────────────────────────────────────────────
   ADD YOUR SOUNDS HERE
   Format:  "soundName": "/sounds/filename.mp3",
───────────────────────────────────────────────────────────────── */
const CUSTOM_SOUNDS: Record<string, string> = {
  // "winBig":    "/sounds/win-big.mp3",
  // "jackpot2":  "/sounds/jackpot.mp3",
  // "countdown": "/sounds/countdown.wav",
};
/* ─────────────────────────────────────────────────────────────────
   END OF SOUND LIST — no need to edit anything below this line
───────────────────────────────────────────────────────────────── */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MASTER_VOLUME = 0.065;

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const loadingSet  = new Set<string>();

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function makeMaster(ac: AudioContext): GainNode {
  const g = ac.createGain();
  g.gain.value = MASTER_VOLUME;
  g.connect(ac.destination);
  return g;
}

/** Pre-load all registered custom sounds into memory. Call once at app start (optional). */
export function preloadCustomSounds(): void {
  Object.entries(CUSTOM_SOUNDS).forEach(([name]) => loadBuffer(name).catch(() => {}));
}

async function loadBuffer(name: string): Promise<AudioBuffer | null> {
  if (bufferCache.has(name)) return bufferCache.get(name)!;
  if (loadingSet.has(name))  return null;

  const path = CUSTOM_SOUNDS[name];
  if (!path) return null;

  loadingSet.add(name);
  try {
    const ac  = getCtx();
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw     = await res.arrayBuffer();
    const decoded = await ac.decodeAudioData(raw);
    bufferCache.set(name, decoded);
    return decoded;
  } catch (e) {
    console.warn(`[customSounds] Failed to load "${name}":`, e);
    return null;
  } finally {
    loadingSet.delete(name);
  }
}

/**
 * Play a registered custom sound by name.
 * Safe to call even before the buffer is loaded — it will load on first call.
 *
 * @param name   Key from the CUSTOM_SOUNDS map above.
 * @param volume Optional 0–1 multiplier on top of the master volume.
 */
export function playCustomSound(name: string, volume = 1): void {
  if (!CUSTOM_SOUNDS[name]) {
    console.warn(`[customSounds] Unknown sound "${name}". Add it to CUSTOM_SOUNDS in customSounds.ts.`);
    return;
  }

  loadBuffer(name)
    .then(buffer => {
      if (!buffer) return;
      const ac  = getCtx();
      const m   = makeMaster(ac);
      const src = ac.createBufferSource();
      src.buffer = buffer;

      if (volume !== 1) {
        const gain = ac.createGain();
        gain.gain.value = Math.max(0, Math.min(1, volume));
        src.connect(gain);
        gain.connect(m);
      } else {
        src.connect(m);
      }

      src.start(ac.currentTime);
    })
    .catch(() => {});
}

/** List all registered sound names (useful for debugging). */
export function listCustomSounds(): string[] {
  return Object.keys(CUSTOM_SOUNDS);
}
