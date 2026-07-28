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
  // Per-payline "multi" cue — plays at the start of each winning payline.
  "multi": "/sounds/multi.mp3",
  // Per-reel "scatter_land" cue — fires whenever a Scatter is present in
  // the column that just came to rest. One play per reel (even if multiple
  // Scatters land in the same column) so the sound feels like a punch,
  // not a machine-gun retrigger.
  "scatter_land": "/sounds/scatter_land.webm",
  // Celebratory sting that fires the instant the bonus ENTRY scene
  // appears — distinct from the per-reel scatter land + the bg music
  // loop, so the three layers read as separate events:
  //   1. bonus_entry (this)     → "bonus just awarded"
  //   2. scatter_land (webm)    → per-reel scatter punch while spinning
  //   3. western_bonus (mp3)    → bg loop once player taps to continue
  "bonus_entry": "/sounds/bonus_entry.mp3",
  // Background music loop that fires the moment the player taps off the
  // bonus entry scene and runs until the bonus round ends.
  "western_bonus": "/sounds/western_bonus.mp3",
  // Looping count-up bed for Huge, Mega, and Jackpot win popups.
  "win_count": "/sounds/win_count.webm",
  // "winBig":    "/sounds/win-big.mp3",
  // "jackpot2":  "/sounds/jackpot.mp3",
  // "countdown": "/sounds/countdown.wav",
};
/* ─────────────────────────────────────────────────────────────────
   ADD YOUR PER-CUE VOLUME DEFAULTS HERE
   Format:  "soundName": 0–1 multiplier on top of CUSTOM_SOUNDS.
   Multiplied with the optional `volume` arg passed by the caller.
   Use this when a cue needs to sit quieter (or louder) than the
   master without retuning every other custom sound.
───────────────────────────────────────────────────────────────── */
const CUSTOM_SOUND_VOLUMES: Record<string, number> = {
  // "multi" sits under the win_end_bet sting intentionally — keep it
  // lower than the celebration so it underscores rather than fights it.
  "multi": 0.4,
  // "scatter_land" is the headline beat when a Scatter appears — sit it
  // below the "multi" cue so it reads as a subtle tease tag, not a punch.
  // 0.20 × master 0.5 = 0.10 effective gain — present but unobtrusive.
  // Tunable independently of the master gain.
  "scatter_land": 0.20,
  // 0.3 — half of the original 0.6 — for the bonus entry sting:
  // punchy + celebratory but below full master; sits clearly above
  // the bg loop so it reads as the headline moment.
  "bonus_entry": 0.3,
  // 0.08575 — 70% of the previous 0.1225 — keeps the bonus loop well
  // under reel-stop stings + win cues so it whispers atmosphere
  // instead of competing with the celebration cues.
  "western_bonus": 0.08575,
  // Keep the count-up bed present but underneath the popup presentation.
  "win_count": 0.3,
  // "winBig":    0.6,
  // "jackpot2":  0.8,
};
/* ─────────────────────────────────────────────────────────────────
   END OF SOUND LIST — no need to edit anything below this line
───────────────────────────────────────────────────────────────── */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// Mutable so the western-slots volume slider can drive both the
// currently-playing bonus loop AND any newly-fired custom cue, without
// recreating the gain graph (which would re-trigger the audio).
let masterGainValue = 0.5;
let sharedMasterGain: GainNode | null = null;
// Mute button has its own gate downstream of `sharedMasterGain` so we
// can kill the bonus loop (and every other custom cue) in real time
// without clobbering the user's volume slider position — silencing
// happens at the gate, the master gain (and therefore the slider
// level) is preserved across mute toggles.
let mutedFlag = false;
let sharedMuteGate: GainNode | null = null;

let audioCtx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const loadingSet  = new Set<string>();
// Tracks the currently-playing AudioBufferSourceNode per cue name so a
// retrigger can stop the previous instance cleanly instead of overlapping.
// Entries are cleared either by the source's `onended` callback or by the
// explicit stopCustomSound() helper.
const activeSources = new Map<string, AudioBufferSourceNode>();

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function makeMaster(ac: AudioContext): GainNode {
  // Shared master GainNode so the western-slots volume slider can
  // re-tune gain on a single, already-connected node. The currently
  // looping bonus music + any newly-started one-shot both pick up the
  // slider value immediately — no BufferSourceNode recreation (which
  // would restart the source from frame 0). A separate `muteGate`
  // downstream handles the mute button so we can preserve the user's
  // slider level across mute toggles.
  if (!sharedMasterGain) {
    sharedMasterGain = ac.createGain();
    sharedMasterGain.gain.value = masterGainValue;
    sharedMuteGate = ac.createGain();
    sharedMuteGate.gain.value = mutedFlag ? 0 : 1;
    sharedMasterGain.connect(sharedMuteGate);
    sharedMuteGate.connect(ac.destination);
  } else if (sharedMasterGain.gain.value !== masterGainValue) {
    sharedMasterGain.gain.value = masterGainValue;
  }
  return sharedMasterGain;
}

/** Match the western-slots volume slider. 0 = silent, 1 = full.
 *  Re-routes gain on the shared master so already-playing audio
 *  (including the bonus loop) AND any cue started after this call
 *  both follow the slider in real time. */
export function setCustomSoundsVolume(v: number): void {
  masterGainValue = Math.max(0, Math.min(1, v));
  if (sharedMasterGain) sharedMasterGain.gain.value = masterGainValue;
}

/** Match the western-slots mute button. Routes through the shared
 *  mute gate so the bonus loop (and every other custom cue) goes
 *  silent in real time while preserving the user's volume slider
 *  position so an unmute restores the same level. */
export function setCustomSoundsMuted(m: boolean): void {
  mutedFlag = m;
  if (sharedMuteGate) sharedMuteGate.gain.value = mutedFlag ? 0 : 1;
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
      // If a previous instance of this cue is still playing, stop it
      // cleanly before starting a new one so the new play restarts at
      // frame 0 instead of overlapping. Required when calls come faster
      // than the natural duration (per-payline cues retrigger each cycle).
      const prev = activeSources.get(name);
      if (prev) {
        try { prev.stop(); } catch {}
        activeSources.delete(name);
      }
      const src = ac.createBufferSource();
      src.buffer = buffer;
      activeSources.set(name, src);
      src.onended = () => {
        // Auto-clear the registry when the source finishes naturally so
        // the map only holds currently-playing instances.
        if (activeSources.get(name) === src) activeSources.delete(name);
      };

      const baseVol = CUSTOM_SOUND_VOLUMES[name] ?? 1;
      const effective = Math.max(0, Math.min(1, baseVol * volume));
      if (effective !== 1) {
        const gain = ac.createGain();
        gain.gain.value = effective;
        src.connect(gain);
        gain.connect(m);
      } else {
        src.connect(m);
      }

      src.start(ac.currentTime);
    })
    .catch(() => {});
}

/** Stop the currently-playing instance of a custom cue, if any.
 *  No-op when the cue isn't currently in flight. Used on spin-start or
 *  win-sequence cancellation to silence its tail cleanly. */
export function stopCustomSound(name: string): void {
  const prev = activeSources.get(name);
  if (!prev) return;
  try { prev.stop(); } catch {}
  activeSources.delete(name);
}

/**
 * Loop primitives — separate registry from the one-shot `activeSources`
 * map so a loop can run without being cancelled by an unrelated trigger
 * of the same name and vice-versa.
 */
const loopingSources = new Map<string, AudioBufferSourceNode>();
const pendingLoops = new Set<string>();
export const WIN_COUNT_START_SEMITONES = -2;
export const WIN_COUNT_END_SEMITONES = 10;
export const WIN_COUNT_START_INTERVAL_MS = 190;
export const WIN_COUNT_END_INTERVAL_MS = 70;
export const WIN_COUNT_PITCH_CURVE = 1.35;

let winCountTimer: ReturnType<typeof setTimeout> | null = null;
let winCountGeneration = 0;
let winCountProgress = 0;
let winCountActive = false;

function triggerWinCountBurst(buffer: AudioBuffer, generation: number): void {
  if (!winCountActive || generation !== winCountGeneration) return;
  const ac = getCtx();
  const master = makeMaster(ac);
  const progress = Math.max(0, Math.min(1, winCountProgress));
  const pitchProgress = Math.pow(progress, WIN_COUNT_PITCH_CURVE);
  const semitones = WIN_COUNT_START_SEMITONES
    + (WIN_COUNT_END_SEMITONES - WIN_COUNT_START_SEMITONES) * pitchProgress;
  const playbackRate = Math.pow(2, semitones / 12);
  const interval = WIN_COUNT_START_INTERVAL_MS
    + (WIN_COUNT_END_INTERVAL_MS - WIN_COUNT_START_INTERVAL_MS) * progress;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  // Each burst gets its own fixed pitch. We never modify an already-playing
  // source, so the audible pitch changes in clean, intentional steps.
  src.playbackRate.setValueAtTime(playbackRate, ac.currentTime);
  const baseVol = CUSTOM_SOUND_VOLUMES.win_count ?? 1;
  const gain = ac.createGain();
  gain.gain.value = Math.max(0, Math.min(1, baseVol));
  src.connect(gain);
  gain.connect(master);
  src.start(ac.currentTime);
  src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch {} };
  winCountTimer = setTimeout(() => triggerWinCountBurst(buffer, generation), interval);
}

/** Start a registered custom sound looping continuously.
 *  Repeated calls while the loop is active are ignored so count-up
 *  re-renders do not restart the audio.
 *  The optional `pitchRampSeconds` argument is retained for compatibility. */
export function startLoop(name: string, volume = 1, _pitchRampSeconds?: number): void {
  if (!CUSTOM_SOUNDS[name]) {
    console.warn(`[customSounds] Unknown sound "${name}". Add it to CUSTOM_SOUNDS in customSounds.ts.`);
    return;
  }
  // Repeated lifecycle checks (including the win counter updates) should
  // not restart the loop. Keeping the same BufferSource alive is what lets
  // its pitch rise continuously instead of jumping back to the base pitch.
  if (loopingSources.has(name) || pendingLoops.has(name)) return;
  pendingLoops.add(name);
  loadBuffer(name).then(buffer => {
    pendingLoops.delete(name);
    if (!buffer) return;
    const ac = getCtx();
    const m  = makeMaster(ac);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    loopingSources.set(name, src);
    src.onended = () => {
      if (loopingSources.get(name) === src) loopingSources.delete(name);
    };
    const baseVol = CUSTOM_SOUND_VOLUMES[name] ?? 1;
    const effective = Math.max(0, Math.min(1, baseVol * volume));
    if (effective !== 1) {
      const gain = ac.createGain();
      gain.gain.value = effective;
      src.connect(gain);
      gain.connect(m);
    } else {
      src.connect(m);
    }
    src.start(ac.currentTime);
  }).catch(() => {});
}

/** Start the repeated one-shot win counter scheduler. */
export function startWinCountSound(): void {
  if (winCountActive) return;
  winCountActive = true;
  winCountProgress = 0;
  const generation = ++winCountGeneration;
  loadBuffer("win_count").then(buffer => {
    if (!buffer || !winCountActive || generation !== winCountGeneration) return;
    triggerWinCountBurst(buffer, generation);
  }).catch(() => {});
}

/** Update the next one-shot pitch and interval from displayed/final amount. */
export function updateWinCountPitch(currentAmount: number, finalAmount: number): void {
  if (!winCountActive) return;
  winCountProgress = finalAmount > 0
    ? Math.max(0, Math.min(1, currentAmount / finalAmount))
    : 0;
  if (winCountProgress >= 1) stopWinCountSound();
}

/** Stop scheduling immediately; already-triggered short bursts may finish. */
export function stopWinCountSound(): void {
  winCountActive = false;
  winCountProgress = 0;
  winCountGeneration++;
  if (winCountTimer !== null) {
    clearTimeout(winCountTimer);
    winCountTimer = null;
  }
}

/** Stop a currently-looping custom cue. No-op if not running. */
export function stopLoop(name: string): void {
  pendingLoops.delete(name);
  const prev = loopingSources.get(name);
  if (!prev) return;
  try { prev.stop(); } catch {}
  loopingSources.delete(name);
}

/** List all registered sound names (useful for debugging). */
export function listCustomSounds(): string[] {
  return Object.keys(CUSTOM_SOUNDS);
}
