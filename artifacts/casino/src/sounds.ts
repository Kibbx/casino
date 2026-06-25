let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function getMaster(): GainNode {
  const ac = getCtx();
  if (!masterGain) {
    masterGain = ac.createGain();
    masterGain.gain.value = 1.0;
    masterGain.connect(ac.destination);
  }
  return masterGain;
}

export function setMasterVolume(v: number) {
  getMaster().gain.value = Math.max(0, Math.min(1, v));
}

export function getMasterVolume(): number {
  return masterGain?.gain.value ?? 1.0;
}

const base = () => (import.meta.env.BASE_URL as string).replace(/\/$/, "");

function loadBuffer(url: string): Promise<AudioBuffer> {
  const ac = getCtx();
  return fetch(url)
    .then((r) => r.arrayBuffer())
    .then((arr) => ac.decodeAudioData(arr));
}

function makeSound(path: string, gain: number) {
  let promise: Promise<AudioBuffer> | null = null;

  function load() {
    if (!promise) promise = loadBuffer(`${base()}${path}`).catch((e) => { promise = null; throw e; });
    return promise;
  }

  function play() {
    const ac = getCtx();
    load().then((buf) => {
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(g).connect(getMaster());
      src.start();
    }).catch(() => {});
  }

  return { load, play };
}

const gunshot  = makeSound("/mob-tower-gunshot.mp3",  0.40);
const siren    = makeSound("/mob-tower-siren.mp3",    0.30);
const cashout  = makeSound("/mob-tower-cashout.mp3",  0.30);

export function soundSafe()    { gunshot.play(); }
export function soundBust()    { siren.play(); }
export function soundCashout() { cashout.play(); }

export function preloadSounds() {
  gunshot.load().catch(() => {});
  siren.load().catch(() => {});
  cashout.load().catch(() => {});
}
