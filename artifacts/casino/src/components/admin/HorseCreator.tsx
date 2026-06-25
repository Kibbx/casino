import { useState, useCallback } from "react";
import {
  Plus, RefreshCw, Trash2, Copy, Shuffle, X, Star, Dices,
} from "lucide-react";
import { HorseSprite, BASE_OPTIONS, PATTERN_OPTIONS, FLAIR_OPTIONS } from "../horses/HorseSprite";
import { SpriteRenderer } from "../horses/SpriteRenderer";
import { SpriteFramePicker } from "../horses/SpriteFramePicker";
import { HorseEffectLayer, EFFECT_OPTIONS, type EffectType } from "../horses/HorseEffectLayer";
import { HORSE_SPRITES } from "../../config/horseSprites";
import { RARITIES, type Rarity } from "../../config/rarityConfig";
import { useStore } from "../../store";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, method = "GET", body?: object) {
  const { bankerToken, sessionToken } = useStore.getState();
  const token = bankerToken || sessionToken || "";
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const BASE_LABELS: Record<string, string> = {
  brown: "Brown", black: "Black", white: "White", grey: "Grey",
  chestnut: "Chestnut", dark_bay: "Dark Bay", palomino: "Palomino",
  bay: "Bay", cream: "Cream", copper: "Copper", dapple_grey: "Dapple",
  roan: "Roan", sand: "Sand", mahogany: "Mahogany",
};
const BASE_COLORS: Record<string, string> = {
  brown: "#8B4513", black: "#1a1a1a", white: "#e8e8e8", grey: "#808080",
  chestnut: "#CD5C5C", dark_bay: "#3B1F10", palomino: "#D4A843",
  bay: "#7B3F00", cream: "#F0DEB4", copper: "#B87333", dapple_grey: "#9A9A9A",
  roan: "#9B6B5B", sand: "#C4A882", mahogany: "#4A1C00",
};
const PATTERN_LABELS: Record<string, string> = {
  none: "None", blaze: "Blaze", socks: "Socks",
  stripe: "Stripe", spotted: "Spotted", pinto: "Pinto",
  tobiano: "Tobiano", star: "Star", sabino: "Sabino",
};
const FLAIR_LABELS: Record<string, string> = {
  none: "None", glow: "Glow", smoke: "Smoke",
  fire: "Fire", neon: "Neon", electric: "Electric", gold: "Gold",
};

const TACK_PRESETS = [
  { label: "Red",    color: "#dc2626" },
  { label: "Blue",   color: "#2563eb" },
  { label: "Green",  color: "#16a34a" },
  { label: "Purple", color: "#9333ea" },
  { label: "Gold",   color: "#f59e0b" },
  { label: "Pink",   color: "#ec4899" },
  { label: "Teal",   color: "#0d9488" },
  { label: "Orange", color: "#ea580c" },
  { label: "White",  color: "#e5e7eb" },
  { label: "Black",  color: "#27272a" },
];

const NAME_PREFIXES = [
  "Storm","Shadow","Thunder","Dark","Wild","Iron","Silver","Ghost",
  "Blaze","Night","Crimson","Swift","Golden","Black","Midnight",
  "Jade","Steel","Ember","Frost","Copper","Scarlet","Desert",
];
const NAME_SUFFIXES = [
  "Rider","Bolt","Star","Wind","Fire","Arrow","Fang","Heart",
  "Spirit","Dancer","Runner","Fury","Blaze","Streak","Legend",
  "Prince","Baron","King","Flash","Comet","Tempest","Phantom",
];

function randomName() {
  return `${NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]} ${
    NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)]}`;
}
function randomHex() {
  return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
}

// Row 9 sprint animation: row*9+col = 9*9+0 .. 9*9+5 = indices 81-86 (6 frames, 3 blank cols skipped)
const DEFAULT_FRAMES = [81, 82, 83, 84, 85, 86];
const DEFAULT_FPS    = 16;

export interface EditableHorse {
  id: number;
  name: string;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  rarity: string;
  speed: number;
  stamina: number;
  acceleration: number;
  luck: number;
  baseSpriteKey: string | null;
  animFrames: string | number[] | null;
  animFps: number;
  effectType: string;
  glowColor: string | null;
  outlineColor: string | null;
  tackColor: string | null;
}

interface Props {
  editingHorse?: EditableHorse | null;
  onSaved?: () => void;
  onDeleted?: () => void;
  onClearEdit?: () => void;
}

type TabKey = "visual" | "stats" | "effects";

function StatSlider({ label, value, onChange, color }: {
  label: string; value: number; onChange: (v: number) => void; color: string;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold font-mono" style={{ color }}>{value}</span>
      </div>
      <div className="relative h-2 bg-muted rounded-full">
        <div className="absolute left-0 top-0 h-full rounded-full transition-all"
          style={{ width: `${value}%`, background: color }} />
        <input type="range" min={1} max={100} value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
      </div>
    </div>
  );
}

function parseStoredFrames(raw: number[] | string | null | undefined): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw as string); } catch { return []; }
}

export function HorseCreator({ editingHorse, onSaved, onDeleted, onClearEdit }: Props) {
  const isEditing = !!editingHorse;

  const [tab,            setTab]          = useState<TabKey>("visual");
  const [name,           setName]         = useState(editingHorse?.name ?? "");
  const [visualBase,     setVisualBase]   = useState(editingHorse?.visualBase ?? "brown");
  const [visualPattern,  setVisualPattern]= useState(editingHorse?.visualPattern ?? "none");
  const [visualFlair,    setVisualFlair]  = useState(editingHorse?.visualFlair ?? "none");
  const [rarity,         setRarity]       = useState<Rarity>((editingHorse?.rarity as Rarity) ?? "common");
  const [speed,          setSpeed]        = useState(editingHorse?.speed ?? 50);
  const [stamina,        setStamina]      = useState(editingHorse?.stamina ?? 50);
  const [acceleration,   setAcceleration] = useState(editingHorse?.acceleration ?? 50);
  const [luck,           setLuck]         = useState(editingHorse?.luck ?? 50);
  const [baseSpriteKey,  setBaseSpriteKey]= useState<string | null>(editingHorse?.baseSpriteKey ?? null);
  const [animFrames,     setAnimFrames]   = useState<number[]>(
    parseStoredFrames(editingHorse?.animFrames) || DEFAULT_FRAMES,
  );
  const [animFps,        setAnimFps]      = useState(editingHorse?.animFps ?? DEFAULT_FPS);
  const [effectType,     setEffectType]   = useState<EffectType>((editingHorse?.effectType as EffectType) ?? "none");
  const [glowColor,      setGlowColor]    = useState(editingHorse?.glowColor ?? "#f59e0b");
  const [outlineColor,   setOutlineColor] = useState(editingHorse?.outlineColor ?? "#ffffff");
  const [useGlow,        setUseGlow]      = useState(!!editingHorse?.glowColor);
  const [useOutline,     setUseOutline]   = useState(!!editingHorse?.outlineColor);
  const [tackColor,      setTackColor]    = useState<string | null>(editingHorse?.tackColor ?? null);
  const [saving,         setSaving]       = useState(false);
  const [deleting,       setDeleting]     = useState(false);
  const [duplicating,    setDuplicating]  = useState(false);
  const [confirmDelete,  setConfirmDelete]= useState(false);
  const [msg,            setMsg]          = useState<{ text: string; ok: boolean } | null>(null);

  const flash = useCallback((text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3000);
  }, []);

  function randomize() {
    const rarityOpts: Rarity[] = ["common","common","uncommon","uncommon","rare","epic","legendary"];
    const newRarity  = rarityOpts[Math.floor(Math.random() * rarityOpts.length)];
    const newBase    = BASE_OPTIONS[Math.floor(Math.random() * BASE_OPTIONS.length)];
    const newPattern = PATTERN_OPTIONS[Math.floor(Math.random() * PATTERN_OPTIONS.length)];
    const newFlair   = FLAIR_OPTIONS[Math.floor(Math.random() * FLAIR_OPTIONS.length)];
    const effectOpts: EffectType[] = ["none","none","glow","outline","dust","sparkles","fire","speed","poison","rainbow","ghost","neon","void","gold","wind","comet","mud","stars","holy","blizzard","crystal","venom","meteor","blood","plague"];
    const newEffect  = effectOpts[Math.floor(Math.random() * effectOpts.length)];
    const spriteOpts = HORSE_SPRITES.map((s) => s.key);
    const newSprite  = spriteOpts[Math.floor(Math.random() * spriteOpts.length)];
    const statBase   = newRarity === "legendary" ? 65 : newRarity === "epic" ? 55 : newRarity === "rare" ? 45 : 35;
    const statRand   = () => Math.min(100, statBase + Math.floor(Math.random() * 30));
    const newTack = Math.random() < 0.6 ? TACK_PRESETS[Math.floor(Math.random() * TACK_PRESETS.length)].color : null;
    setName(randomName()); setRarity(newRarity);
    setVisualBase(newBase); setVisualPattern(newPattern); setVisualFlair(newFlair);
    setEffectType(newEffect); setBaseSpriteKey(newSprite);
    setAnimFrames(DEFAULT_FRAMES); setAnimFps(DEFAULT_FPS);
    setSpeed(statRand()); setStamina(statRand()); setAcceleration(statRand()); setLuck(statRand());
    setGlowColor(randomHex());
    setUseGlow(["glow","neon","void","rainbow"].includes(newEffect));
    setUseOutline(newEffect === "outline");
    setTackColor(newTack);
  }

  function buildPayload() {
    return {
      name: name.trim(),
      visualBase, visualPattern, visualFlair, rarity,
      speed, stamina, acceleration, luck,
      baseSpriteKey: baseSpriteKey || null,
      animFrames: animFrames.length > 0 ? JSON.stringify(animFrames) : null,
      animFps,
      effectType,
      glowColor: useGlow ? glowColor : null,
      outlineColor: useOutline ? outlineColor : null,
      tackColor: tackColor || null,
    };
  }

  async function save() {
    if (!name.trim()) { flash("Horse name is required.", false); return; }
    setSaving(true);
    try {
      if (isEditing) {
        await apiFetch("/admin/horses/update-one", "POST", { id: editingHorse!.id, ...buildPayload() });
        flash(`"${name.trim()}" updated!`, true);
      } else {
        await apiFetch("/admin/horses/create", "POST", buildPayload());
        flash(`"${name.trim()}" created!`, true);
        setName(""); setVisualBase("brown"); setVisualPattern("none"); setVisualFlair("none");
        setRarity("common"); setSpeed(50); setStamina(50); setAcceleration(50); setLuck(50);
        setBaseSpriteKey(null); setAnimFrames(DEFAULT_FRAMES); setAnimFps(DEFAULT_FPS);
        setEffectType("none"); setUseGlow(false); setUseOutline(false); setTackColor(null);
      }
      onSaved?.();
    } catch (e: any) { flash(e.message, false); }
    setSaving(false);
  }

  async function duplicate() {
    if (!isEditing) return;
    setDuplicating(true);
    try {
      await apiFetch("/admin/horses/duplicate", "POST", { id: editingHorse!.id });
      flash("Horse duplicated!", true); onSaved?.();
    } catch (e: any) { flash(e.message, false); }
    setDuplicating(false);
  }

  async function deleteHorse() {
    if (!isEditing) return;
    setDeleting(true);
    try {
      await apiFetch("/admin/horses/delete", "POST", { id: editingHorse!.id });
      flash("Horse deleted.", true); setConfirmDelete(false); onDeleted?.();
    } catch (e: any) { flash(e.message, false); }
    setDeleting(false);
  }

  const rarityDef = RARITIES.find((r) => r.key === rarity) ?? RARITIES[0];

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-base font-display font-semibold text-foreground">
            {isEditing ? `Editing: ${editingHorse!.name}` : "Horse Creator"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEditing ? `Horse #${editingHorse!.id}` : "Create a new race horse"}
          </p>
        </div>
        {isEditing && (
          <button onClick={onClearEdit} className="text-zinc-500 hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="p-5">
        <div className="flex gap-5 flex-wrap">

          {/* ── Preview ─────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            <div
              className="bg-muted/20 border border-border rounded-2xl flex items-center justify-center relative overflow-hidden"
              style={{ width: 160, height: 160 }}
            >
              {rarityDef.glow && (
                <div className="absolute inset-0 rounded-2xl"
                  style={{ background: `radial-gradient(circle at center, ${rarityDef.glow} 0%, transparent 70%)` }} />
              )}
              <HorseEffectLayer
                key={effectType}
                effect={effectType}
                glowColor={useGlow ? glowColor : null}
                outlineColor={useOutline ? outlineColor : null}
                rarity={rarity}
                size={140}
                spriteKey={baseSpriteKey}
              >
                <SpriteRenderer
                  spriteKey={baseSpriteKey}
                  customFrames={animFrames.length > 0 ? animFrames : undefined}
                  customFps={animFps}
                  fallbackBase={visualBase}
                  fallbackPattern={visualPattern}
                  fallbackFlair={visualFlair}
                  size={140}
                  number={1}
                  tackColor={tackColor}
                />
              </HorseEffectLayer>
            </div>

            <div className="text-center space-y-1">
              <p className="text-sm font-bold text-foreground truncate max-w-[148px]">
                {name || "Unnamed Horse"}
              </p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ color: rarityDef.color, background: rarityDef.bg, border: `1px solid ${rarityDef.border}` }}>
                  {rarityDef.label}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-0.5 text-center mt-1">
                {[
                  { label: "SPD", value: speed,        color: "#22d3ee" },
                  { label: "STM", value: stamina,      color: "#4ade80" },
                  { label: "ACC", value: acceleration, color: "#f59e0b" },
                  { label: "LCK", value: luck,         color: "#c084fc" },
                ].map((s) => (
                  <div key={s.label} className="bg-muted/30 rounded-lg px-1 py-0.5">
                    <p className="text-[9px] text-muted-foreground">{s.label}</p>
                    <p className="text-[11px] font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Controls ─────────────────────────────────────────── */}
          <div className="flex-1 min-w-[220px] space-y-4">

            {/* Name + Rarity */}
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Horse Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Storm Rider" maxLength={32}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground block mb-1">Rarity</label>
                <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}
                  className="w-full bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                  style={{ color: rarityDef.color }}>
                  {RARITIES.map((r) => (
                    <option key={r.key} value={r.key} style={{ color: r.color }}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border border-border rounded-xl overflow-hidden">
              {(["visual","stats","effects"] as TabKey[]).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors capitalize ${
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}>
                  {t === "visual" ? "Visual" : t === "stats" ? "Stats" : "Effects"}
                </button>
              ))}
            </div>

            {/* ── Tab: Visual ─────────────────────────────────── */}
            {tab === "visual" && (
              <div className="space-y-4">
                {/* Sprite Frame Picker */}
                <SpriteFramePicker
                  spriteKey={baseSpriteKey}
                  selectedFrames={animFrames}
                  fps={animFps}
                  onSpriteKey={(k) => {
                    setBaseSpriteKey(k);
                    if (!k) { setAnimFrames(DEFAULT_FRAMES); setAnimFps(DEFAULT_FPS); }
                  }}
                  onFrames={setAnimFrames}
                  onFps={setAnimFps}
                />

                {/* CSS fallback visual */}
                <div className="border-t border-border pt-3">
                  <label className="text-xs text-zinc-600 font-medium block mb-2">
                    CSS Fallback <span className="text-[10px] text-zinc-700">(shown if no sprite loaded)</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-600 block mb-1">Base</label>
                      <select value={visualBase} onChange={(e) => setVisualBase(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary">
                        {BASE_OPTIONS.map((b) => <option key={b} value={b}>{BASE_LABELS[b]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-600 block mb-1">Pattern</label>
                      <select value={visualPattern} onChange={(e) => setVisualPattern(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary">
                        {PATTERN_OPTIONS.map((p) => <option key={p} value={p}>{PATTERN_LABELS[p]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-600 block mb-1">Flair</label>
                      <select value={visualFlair} onChange={(e) => setVisualFlair(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary">
                        {FLAIR_OPTIONS.map((f) => <option key={f} value={f}>{FLAIR_LABELS[f]}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-1.5">
                    {BASE_OPTIONS.map((b) => (
                      <button key={b} title={BASE_LABELS[b]} onClick={() => setVisualBase(b)}
                        className={`w-5 h-5 rounded-full border-2 transition-all ${visualBase === b ? "border-primary scale-110" : "border-border"}`}
                        style={{ backgroundColor: BASE_COLORS[b] ?? "#888" }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Stats ──────────────────────────────────── */}
            {tab === "stats" && (
              <div className="space-y-3">
                <StatSlider label="Speed"        value={speed}        onChange={setSpeed}        color="#22d3ee" />
                <StatSlider label="Stamina"      value={stamina}      onChange={setStamina}      color="#4ade80" />
                <StatSlider label="Acceleration" value={acceleration} onChange={setAcceleration} color="#f59e0b" />
                <StatSlider label="Luck"         value={luck}         onChange={setLuck}         color="#c084fc" />
                <button
                  onClick={() => {
                    const b = RARITIES.find((r) => r.key === rarity)?.statBonus ?? 0;
                    const rand = () => Math.min(100, b + 30 + Math.floor(Math.random() * (70 - b)));
                    setSpeed(rand()); setStamina(rand()); setAcceleration(rand()); setLuck(rand());
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-border text-xs text-muted-foreground hover:text-foreground rounded-xl transition-colors"
                >
                  <Dices className="w-3.5 h-3.5" /> Randomize Stats
                </button>
              </div>
            )}

            {/* ── Tab: Effects ────────────────────────────────── */}
            {tab === "effects" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Effect</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {EFFECT_OPTIONS.map((opt) => (
                      <button key={opt.value} onClick={() => setEffectType(opt.value)}
                        className={`px-2 py-1.5 rounded-lg border text-xs text-center transition-all ${
                          effectType === opt.value
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Glow Color</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setUseGlow((v) => !v)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${useGlow ? "border-primary bg-primary/10 text-primary" : "border-border text-zinc-600"}`}>
                        {useGlow ? "On" : "Off"}
                      </button>
                      {useGlow && <input type="color" value={glowColor} onChange={(e) => setGlowColor(e.target.value)}
                        className="w-7 h-7 rounded-lg border border-border cursor-pointer bg-transparent" />}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Outline Color</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setUseOutline((v) => !v)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${useOutline ? "border-primary bg-primary/10 text-primary" : "border-border text-zinc-600"}`}>
                        {useOutline ? "On" : "Off"}
                      </button>
                      {useOutline && <input type="color" value={outlineColor} onChange={(e) => setOutlineColor(e.target.value)}
                        className="w-7 h-7 rounded-lg border border-border cursor-pointer bg-transparent" />}
                    </div>
                  </div>
                </div>

                {/* Tack Color */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground font-medium">Tack Color</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setTackColor(null)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${!tackColor ? "border-primary bg-primary/10 text-primary" : "border-border text-zinc-600"}`}>
                        None
                      </button>
                      <input type="color" value={tackColor ?? "#dc2626"} onChange={(e) => setTackColor(e.target.value)}
                        className="w-7 h-7 rounded-lg border border-border cursor-pointer bg-transparent" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TACK_PRESETS.map((p) => (
                      <button key={p.color} title={p.label}
                        onClick={() => setTackColor(tackColor === p.color ? null : p.color)}
                        style={{ background: p.color, border: tackColor === p.color ? "2px solid white" : "2px solid transparent" }}
                        className="w-5 h-5 rounded-full transition-all hover:scale-110" />
                    ))}
                  </div>
                </div>

                <div className="border border-border rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Rarity Auto-Effects</p>
                  <div className="space-y-1">
                    {RARITIES.map((r) => (
                      <div key={r.key} className="flex items-center justify-between text-xs">
                        <span style={{ color: r.color }}>{r.label}</span>
                        <span className="text-zinc-600">
                          {r.autoEffect !== "none" && r.autoEffect}
                          {r.hasTrail && " + trail"}
                          {r.hasParticles && " + particles"}
                          {r.autoEffect === "none" && !r.hasTrail && "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Flash message */}
        {msg && (
          <p className={`mt-3 text-xs font-semibold text-center ${msg.ok ? "text-green-400" : "text-red-400"}`}>
            {msg.text}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap mt-4">
          <button onClick={save} disabled={saving || !name.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold rounded-xl disabled:opacity-40 transition-colors">
            {saving
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</>
              : isEditing
              ? <><Star className="w-4 h-4" /> Save Changes</>
              : <><Plus className="w-4 h-4" /> Create Horse</>}
          </button>
          <button onClick={randomize}
            className="flex items-center gap-2 px-4 py-2.5 border border-border text-muted-foreground hover:text-foreground text-sm font-bold rounded-xl transition-colors">
            <Shuffle className="w-4 h-4" /> Randomize
          </button>
          {isEditing && (
            <>
              <button onClick={duplicate} disabled={duplicating}
                className="flex items-center gap-2 px-4 py-2.5 border border-border text-muted-foreground hover:text-foreground text-sm font-bold rounded-xl transition-colors disabled:opacity-40">
                {duplicating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                Duplicate
              </button>
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-2 px-4 py-2.5 border border-red-700 text-red-400 hover:bg-red-950 text-sm font-bold rounded-xl transition-colors">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={deleteHorse} disabled={deleting}
                    className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40">
                    {deleting ? "Deleting…" : "Confirm Delete"}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="px-3 py-2.5 border border-border text-xs text-muted-foreground hover:text-foreground rounded-xl">
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
