import { useState, useEffect, useCallback, useRef } from "react";
import { useWs } from "../lib/WsContext";
import {
  Play, Square, X, RefreshCw, Save, ChevronDown, ChevronUp,
  Search, UserPlus, Calendar, Unlock, RotateCcw, Trophy, Pencil,
} from "lucide-react";
import { useStore } from "../store";
import { HorseRaceTrack } from "./HorseRaceTrack";
import { HorseCreator, type EditableHorse } from "./admin/HorseCreator";
import { HorseSprite } from "./horses/HorseSprite";
import { SpriteRenderer } from "./horses/SpriteRenderer";
import { getRarity } from "../config/rarityConfig";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Horse {
  id: number;
  name: string;
  weight: number;
  ownerId: number | null;
  ownerName: string | null;
  ownerCut: number;
  totalEarnings: number;
  variantId: number;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  rarity: string;
  speed: number;
  stamina: number;
  acceleration: number;
  luck: number;
  avgStat: number | null;
  price: number | null;
  isForSale: boolean;
  baseSpriteKey: string | null;
  animFrames: string | null;
  animFps: number;
  effectType: string;
  glowColor: string | null;
  outlineColor: string | null;
  tackColor: string | null;
}

interface RaceHorse {
  id: number;
  name: string;
  variantId: number;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  ownerId?: number | null;
  baseSpriteKey?: string | null;
  animFrames?: string | null;
  animFps?: number;
  effectType?: string;
  glowColor?: string | null;
  outlineColor?: string | null;
  totalBets: number;
  horsePool: number;
  totalPool: number;
  liveOdds: number | null;
}

interface RaceStatus {
  raceId: number;
  status: "idle" | "scheduled" | "betting" | "running" | "finished";
  startTime: number | null;
  startedAt: number | null;
  bettingOpensAt: number | null;
  bettingClosesAt: number | null;
  elapsedMs: number | null;
  winner: { id: number; name: string } | null;
  horses: RaceHorse[];
  queueLength: number;
}

interface QueueEntry {
  queueId: string;
  scheduledTime: number;
  bettingOpensAt: number;
  bettingClosesAt: number;
  priority: boolean;
  type: "manual" | "auto";
  horseCount: number;
  createdAt: number;
}

interface PlayerResult {
  id: number;
  name: string;
  stateId: string | null;
}

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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function useCountdown(target: number | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!target) { setLeft(0); return; }
    const update = () => setLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    update();
    const iv = setInterval(update, 500);
    return () => clearInterval(iv);
  }, [target]);
  return left;
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}


// ── Assign Owner Modal ────────────────────────────────────────────────────

function AssignOwnerModal({ horse, onClose, onAssigned }: {
  horse: Horse;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PlayerResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiFetch(`/admin/players/search?q=${encodeURIComponent(query)}`);
        setResults(data);
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function confirm() {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch("/admin/horses/set-owner", "POST", { horseId: horse.id, ownerId: selected.id });
      setMsg(`Owner set to ${selected.name}`);
      setTimeout(() => { onAssigned(); onClose(); }, 1000);
    } catch (e: any) { setMsg(`Error: ${e.message}`); }
    setSaving(false);
  }

  async function removeOwner() {
    setSaving(true);
    try {
      await apiFetch("/admin/horses/set-owner", "POST", { horseId: horse.id, ownerId: null });
      setMsg("Owner removed");
      setTimeout(() => { onAssigned(); onClose(); }, 800);
    } catch (e: any) { setMsg(`Error: ${e.message}`); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-display font-semibold text-foreground">Assign Owner</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{horse.name} — Variant #{horse.variantId}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {horse.ownerName && (
            <div className="flex items-center justify-between bg-muted/30 rounded-xl px-3 py-2.5">
              <div>
                <p className="text-xs text-muted-foreground">Current owner</p>
                <p className="text-sm font-semibold text-foreground">{horse.ownerName}</p>
              </div>
              <button onClick={removeOwner} disabled={saving}
                className="text-xs text-red-400 hover:text-red-300 border border-red-700 px-2.5 py-1 rounded-lg">
                Remove
              </button>
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Search player by name…"
              className="w-full bg-input border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
            {searching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          </div>
          {results.length > 0 && !selected && (
            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border max-h-52 overflow-y-auto">
              {results.map((p) => (
                <button key={p.id} onClick={() => { setSelected(p); setResults([]); }}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 text-left">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    {p.stateId && <p className="text-xs text-muted-foreground">ID: {p.stateId}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">Selected player</p>
                <p className="text-sm font-semibold text-foreground">{selected.name}</p>
                {selected.stateId && <p className="text-xs text-muted-foreground">ID: {selected.stateId}</p>}
              </div>
              <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
          )}
          {msg && (
            <p className={`text-sm text-center font-semibold ${msg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>{msg}</p>
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={confirm} disabled={!selected || saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl disabled:opacity-40">
            <UserPlus className="w-4 h-4" /> {saving ? "Saving…" : "Assign Owner"}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 border border-border text-muted-foreground hover:text-foreground rounded-xl text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export function HorseRacingAdmin({ canManageHorses = false }: { canManageHorses?: boolean }) {

  const [race, setRace] = useState<RaceStatus | null>(null);
  const [horses, setHorses] = useState<Horse[]>([]);
  const [raceQueue, setRaceQueue] = useState<QueueEntry[]>([]);
  const [edits, setEdits] = useState<Map<number, { name: string }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [assignHorse, setAssignHorse] = useState<Horse | null>(null);
  const [scheduleMinutes, setScheduleMinutes] = useState("10");
  const [editingHorse, setEditingHorse] = useState<EditableHorse | null>(null);
  const [horsePositions, setHorsePositions] = useState<Record<number, number>>({});
  const [priceEdits, setPriceEdits] = useState<Map<number, string>>(new Map());
  const [savingPriceId, setSavingPriceId] = useState<number | null>(null);
  // Queue creation state
  const [priority, setPriority] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { subscribe } = useWs();

  const countdown = useCountdown(race?.startTime ?? null);

  const loadStatus = useCallback(async () => {
    try { const data = await apiFetch("/horse/status"); setRace(data); } catch {}
  }, []);

  const loadHorses = useCallback(async () => {
    try { const data = await apiFetch("/admin/horses"); setHorses(data); } catch {}
  }, []);

  const loadQueue = useCallback(async () => {
    try { const data = await apiFetch("/admin/race/queue"); setRaceQueue(data.queue ?? []); } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
    loadHorses();
    loadQueue();
    const iv = setInterval(() => { void loadStatus(); void loadQueue(); }, 2000);
    return () => clearInterval(iv);
  }, [loadStatus, loadHorses, loadQueue]);

  useEffect(() => {
    const unsub = subscribe("race_update", (msg: { horses: { id: number; position: number }[] }) => {
      setHorsePositions((prev) => {
        const next = { ...prev };
        for (const h of msg.horses) next[h.id] = h.position;
        return next;
      });
    });
    return unsub;
  }, [subscribe]);

  function getEdit(id: number, horse: Horse) {
    return edits.get(id) ?? { name: horse.name };
  }

  function setEdit(id: number, field: "name", value: string) {
    setEdits((prev) => {
      const next = new Map(prev);
      const horse = horses.find((h) => h.id === id)!;
      const cur = next.get(id) ?? { name: horse.name };
      next.set(id, { ...cur, [field]: value });
      return next;
    });
  }

  async function saveHorses() {
    if (edits.size === 0) { flash("No changes to save.", true); return; }
    setSaving(true);
    try {
      const payload = Array.from(edits.entries()).map(([id, e]) => ({
        id,
        name: e.name.trim() || `Horse #${id}`,
      }));
      await apiFetch("/admin/horses/update", "POST", payload);
      await loadHorses();
      setEdits(new Map());
      flash("Saved!", true);
    } catch (e: any) { flash(`Error: ${e.message}`, false); }
    setSaving(false);
  }

  async function saveHorsePrice(horse: Horse) {
    const draft = priceEdits.get(horse.id);
    const newPrice = draft !== undefined ? draft : (horse.price != null ? String(horse.price) : "");
    const parsed = newPrice.trim() === "" ? null : parseInt(newPrice.replace(/[^0-9]/g, ""), 10);
    if (parsed !== null && isNaN(parsed)) return;
    setSavingPriceId(horse.id);
    try {
      await apiFetch("/admin/horses/set-price", "POST", { id: horse.id, price: parsed });
      setPriceEdits((prev) => { const next = new Map(prev); next.delete(horse.id); return next; });
      await loadHorses();
    } catch (e: any) { flash(`Price error: ${e.message}`, false); }
    setSavingPriceId(null);
  }

  function flash(text: string, ok: boolean) {
    setActionMsg({ text, ok });
    setTimeout(() => setActionMsg(null), 3000);
  }

  async function doAction(action: string, body?: object) {
    setLoading(true);
    try {
      await apiFetch(`/admin/race/${action}`, "POST", body);
      await loadStatus();
      await loadQueue();
      const labels: Record<string, string> = {
        schedule: "Race scheduled!",
        "open-betting": "Betting opened!",
        start: "Race started!",
        finish: "Race finished!",
        cancel: "Race cancelled.",
        reset: "Race reset.",
        "create-now": "Instant race added to queue!",
        "create-scheduled": "Race scheduled and added to queue!",
      };
      flash(labels[action] ?? "Done!", true);
    } catch (e: any) { flash(e.message, false); }
    setLoading(false);
  }

  async function createInstantRace() {
    setLoading(true);
    try {
      await apiFetch("/admin/race/create-now", "POST", { priority });
      await loadStatus();
      await loadQueue();
      flash(priority ? "⚡ Priority instant race queued!" : "Instant race added to queue!", true);
    } catch (e: any) { flash(e.message, false); }
    setLoading(false);
  }

  async function createScheduledRace() {
    if (!scheduleDateTime) { flash("Pick a date and time first.", false); return; }
    const epochMs = new Date(scheduleDateTime).getTime();
    if (isNaN(epochMs)) { flash("Invalid date/time.", false); return; }
    setLoading(true);
    try {
      await apiFetch("/admin/race/create-scheduled", "POST", {
        scheduledTime: epochMs,
        priority,
      });
      await loadStatus();
      await loadQueue();
      flash("Race scheduled!", true);
      setShowScheduleForm(false);
      setScheduleDateTime("");
    } catch (e: any) { flash(e.message, false); }
    setLoading(false);
  }

  async function cancelQueuedRace(queueId: string) {
    setCancellingId(queueId);
    try {
      const { bankerToken, sessionToken } = useStore.getState();
      const token = bankerToken || sessionToken || "";
      const res = await fetch(`${BASE_URL}/api/admin/race/queue/${queueId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      await loadQueue();
      flash("Queued race removed.", true);
    } catch (e: any) { flash(e.message, false); }
    setCancellingId(null);
  }

  const status = race?.status ?? "idle";
  const totalPool = race?.horses[0]?.totalPool ?? 0;
  const trackHorses = race?.horses.map((h) => ({
    id: h.id, name: h.name, variantId: h.variantId ?? 1,
    visualBase: h.visualBase ?? "brown",
    visualPattern: h.visualPattern ?? "none",
    visualFlair: h.visualFlair ?? "none",
    ownerId: h.ownerId ?? null,
    baseSpriteKey: h.baseSpriteKey ?? null,
    animFrames: h.animFrames ?? null,
    animFps: h.animFps ?? 12,
    effectType: h.effectType ?? "none",
    glowColor: h.glowColor ?? null,
    outlineColor: h.outlineColor ?? null,
    tackColor: h.tackColor ?? null,
    rarity: h.rarity ?? "common",
    speed: h.speed ?? 50,
    stamina: h.stamina ?? 50,
    acceleration: h.acceleration ?? 50,
    luck: h.luck ?? 50,
  })) ?? [];

  const STATUS_COLOR: Record<string, string> = {
    idle: "text-zinc-400", scheduled: "text-purple-400",
    betting: "text-amber-400", running: "text-blue-400", finished: "text-green-400",
  };
  const STATUS_LABEL: Record<string, string> = {
    idle: "Idle", scheduled: "Scheduled", betting: "Betting Open",
    running: "Race Running", finished: "Finished",
  };

  return (
    <div className="space-y-4">
      {/* Flash message */}
      {actionMsg && (
        <div className={`px-4 py-2 rounded-xl text-sm font-semibold text-center ${
          actionMsg.ok ? "bg-green-950 border border-green-700 text-green-400" : "bg-red-950 border border-red-700 text-red-400"
        }`}>
          {actionMsg.text}
        </div>
      )}

      {/* Event control panel */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-display font-semibold text-foreground">🏇 Event Control</h3>
          <button onClick={loadStatus} className="text-zinc-500 hover:text-foreground"><RefreshCw className="w-4 h-4" /></button>
        </div>

        {/* Status + countdown grid */}
        <div className="grid grid-cols-2 grid-cols-4 gap-3">
          <div className="bg-muted/30 rounded-xl px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className={`text-sm font-bold ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</p>
          </div>
          <div className="bg-muted/30 rounded-xl px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Race #</p>
            <p className="text-sm font-bold text-foreground">#{race?.raceId ?? 0}</p>
          </div>
          <div className="bg-muted/30 rounded-xl px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              {status === "scheduled" ? "Starts In" : status === "betting" ? "Betting Closes" : "Phase"}
            </p>
            <p className={`text-sm font-bold font-mono ${
              status === "scheduled" ? "text-purple-300" :
              status === "betting"   ? "text-amber-300" :
              "text-foreground"
            }`}>
              {status === "scheduled" ? fmt(countdown) :
               status === "betting" && race?.bettingClosesAt ? fmt(Math.max(0, Math.ceil((race.bettingClosesAt - Date.now()) / 1000))) :
               status === "running" ? "Running…" : "—"}
            </p>
          </div>
          <div className="bg-muted/30 rounded-xl px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Queue / Pool</p>
            <p className="text-sm font-bold text-foreground">
              <span className="text-blue-400">{(race?.queueLength ?? raceQueue.length)} queued</span>
              {totalPool > 0 && <span className="text-amber-400 ml-1">· {totalPool.toLocaleString()}</span>}
            </p>
          </div>
        </div>

        {/* ── Queue Creation Controls ── */}
        <div className="border border-border/60 rounded-xl p-3 space-y-3 bg-muted/10">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Race to Queue</p>
            {/* Priority toggle */}
            <button
              onClick={() => setPriority(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                priority
                  ? "bg-amber-900 border-amber-600 text-amber-300"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              ⚡ {priority ? "PRIORITY ON" : "Priority"}
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Create Instant Race */}
            <button
              onClick={createInstantRace}
              disabled={loading}
              className={`flex items-center gap-1.5 px-3 py-2 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition-colors ${
                priority ? "bg-amber-600 hover:bg-amber-500" : "bg-green-700 hover:bg-green-600"
              }`}>
              <Play className="w-3.5 h-3.5" />
              {priority ? "⚡ Priority Race Now" : "Race Now (2 min)"}
            </button>

            {/* Toggle schedule form */}
            <button
              onClick={() => setShowScheduleForm(v => !v)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
              <Calendar className="w-3.5 h-3.5" /> Schedule Race
            </button>
          </div>

          {/* Schedule form */}
          {showScheduleForm && (
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  onChange={e => setScheduleDateTime(e.target.value)}
                  className="bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground flex-1 min-w-0"
                />
                <button
                  onClick={createScheduledRace}
                  disabled={loading || !scheduleDateTime}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg disabled:opacity-40 transition-colors">
                  <Calendar className="w-3 h-3" /> Add to Queue
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Betting opens immediately when the race is created. Race auto-starts at the selected time.
              </p>
            </div>
          )}
        </div>

        {/* Legacy schedule input (manual flow) */}
        {(status === "idle" || status === "finished") && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">Manual phase control (legacy)</summary>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <div className="flex items-center gap-2 bg-muted/20 border border-border rounded-xl px-3 py-2">
                <Calendar className="w-4 h-4 text-purple-400 shrink-0" />
                <input
                  type="number" min={0} max={180} value={scheduleMinutes}
                  onChange={(e) => setScheduleMinutes(e.target.value)}
                  className="w-16 bg-transparent text-sm text-foreground outline-none tabular-nums"
                />
                <span className="text-xs text-muted-foreground">min from now</span>
              </div>
              <button
                onClick={() => doAction("schedule", { minutesFromNow: parseInt(scheduleMinutes) || 0 })}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
                <Calendar className="w-3.5 h-3.5" /> Schedule (Direct)
              </button>
            </div>
          </details>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => doAction("open-betting")}
            disabled={loading || (status !== "scheduled" && status !== "idle")}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
            <Unlock className="w-3.5 h-3.5" /> Open Betting
          </button>
          <button
            onClick={() => doAction("start")}
            disabled={loading || status !== "betting"}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
            <Play className="w-3.5 h-3.5" /> Start Race
          </button>
          <button
            onClick={() => doAction("finish")}
            disabled={loading || status !== "running"}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
            <Square className="w-3.5 h-3.5" /> Finish Race
          </button>
          <button
            onClick={() => doAction("cancel")}
            disabled={loading || status === "idle"}
            className="flex items-center gap-1.5 px-3 py-2 border border-red-700 text-red-400 hover:bg-red-950 text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button
            onClick={() => doAction("reset")}
            disabled={loading || status === "idle"}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-600 text-zinc-400 hover:text-foreground text-xs font-bold rounded-xl disabled:opacity-40 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>

        {/* Winner display */}
        {status === "finished" && race?.winner && (
          <div className="px-4 py-3 bg-amber-950 border border-amber-700 rounded-xl flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <div>
              <p className="text-xs text-amber-400">Winner</p>
              <p className="text-sm font-bold text-amber-300">{race.winner.name}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Race Queue Panel ── */}
      {raceQueue.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
              <span className="text-blue-400">▲</span> Race Queue
              <span className="text-xs bg-blue-900 text-blue-400 border border-blue-700 px-2 py-0.5 rounded-full font-bold">
                {raceQueue.length}
              </span>
            </h3>
          </div>
          <div className="space-y-2">
            {raceQueue.map((entry, idx) => {
              const now = Date.now();
              const bettingOpensIn = Math.max(0, Math.ceil((entry.bettingOpensAt - now) / 1000));
              const startIn        = Math.max(0, Math.ceil((entry.scheduledTime  - now) / 1000));
              const bettingIsOpen  = entry.bettingOpensAt <= now;
              return (
                <div key={entry.queueId}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border ${
                    entry.priority ? "border-amber-700 bg-amber-950" : "border-border bg-muted/10"
                  }`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-muted-foreground tabular-nums w-4">{idx + 1}</span>
                    {entry.priority && <span className="text-xs text-amber-400 font-bold">⚡</span>}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {bettingIsOpen ? "🟢 Betting Open" : `Betting in ${fmt(bettingOpensIn)}`}
                        {" · "}
                        <span className="text-muted-foreground">Starts in {fmt(startIn)}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {entry.horseCount} horses · {entry.priority ? "Priority" : "Standard"} · {entry.type}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => cancelQueuedRace(entry.queueId)}
                    disabled={cancellingId === entry.queueId}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 border border-red-700 text-red-400 hover:bg-red-950 text-xs rounded-lg disabled:opacity-40 transition-colors">
                    <X className="w-3 h-3" />
                    {cancellingId === entry.queueId ? "…" : "Remove"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Race track */}
      {race && trackHorses.length > 0 && (
        <HorseRaceTrack
          horses={trackHorses}
          status={race.status}
          winnerId={race.winner?.id ?? null}
          horsePositions={horsePositions}
          raceId={race.raceId}
        />
      )}

      {/* Bet table for current race */}
      {race && race.horses.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h3 className="text-base font-display font-semibold text-foreground mb-3">Race Horses</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Variant</th>
                  <th className="pb-2 font-medium">Horse</th>
                  <th className="pb-2 font-medium">Live Odds</th>
                  <th className="pb-2 font-medium text-right">Pool</th>
                  <th className="pb-2 font-medium text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {race.horses.map((h) => (
                  <tr key={h.id} className={race.winner?.id === h.id ? "bg-amber-950" : ""}>
                    <td className="py-2">
                      <SpriteRenderer
                        spriteKey={(h as any).baseSpriteKey ?? null}
                        animation="idle"
                        size={28}
                        fallbackBase={h.visualBase ?? "brown"}
                        fallbackPattern={h.visualPattern ?? "none"}
                        fallbackFlair={h.visualFlair ?? "none"}
                        tackColor={(h as any).tackColor ?? null}
                      />
                    </td>
                    <td className="py-2 font-medium text-foreground">
                      {race.winner?.id === h.id && <Trophy className="inline w-3.5 h-3.5 text-amber-400 mr-1 -mt-0.5" />}
                      {h.name}
                    </td>
                    <td className="py-2 text-amber-400 font-mono font-bold">
                      {h.liveOdds != null ? `${h.liveOdds.toFixed(2)}×` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{(h.horsePool ?? 0).toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {totalPool > 0 ? `${((h.horsePool / totalPool) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border">
                <tr>
                  <td colSpan={3} className="pt-2 text-xs text-muted-foreground">Total pool</td>
                  <td colSpan={2} className="pt-2 text-right font-bold tabular-nums text-sm text-amber-400">
                    {totalPool.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Horse Creator / Editor — owner/banker only */}
      {canManageHorses && (
        <HorseCreator
          key={editingHorse?.id ?? "new"}
          editingHorse={editingHorse}
          onSaved={() => { loadHorses(); }}
          onDeleted={() => { setEditingHorse(null); loadHorses(); }}
          onClearEdit={() => setEditingHorse(null)}
        />
      )}

      {/* Horse editor */}
      <div className="bg-card border border-border rounded-2xl">
        <button onClick={() => setShowEditor((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left">
          <h3 className="text-base font-display font-semibold text-foreground">Horse Editor (100 Horses)</h3>
          <div className="flex items-center gap-2">
            {edits.size > 0 && (
              <span className="text-xs bg-amber-900 text-amber-400 border border-amber-700 px-2 py-0.5 rounded-full font-bold">
                {edits.size} unsaved
              </span>
            )}
            {showEditor ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>

        {showEditor && (
          <div className="border-t border-border">
            {edits.size > 0 && (
              <div className="px-5 py-3 flex items-center justify-between border-b border-border bg-amber-950">
                <span className="text-xs text-amber-400">{edits.size} horse{edits.size !== 1 ? "s" : ""} edited</span>
                <div className="flex gap-2">
                  <button onClick={saveHorses} disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded-lg disabled:opacity-50">
                    <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEdits(new Map())}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg">
                    Discard
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="px-3 py-2 font-medium w-10">ID</th>
                    <th className="px-2 py-2 font-medium w-8">Img</th>
                    <th className="px-2 py-2 font-medium">Name</th>
                    <th className="px-2 py-2 font-medium w-20">Rarity</th>
                    <th className="px-2 py-2 font-medium text-center w-10">AVG</th>
                    <th className="px-2 py-2 font-medium">Owner</th>
                    <th className="px-2 py-2 font-medium w-32">Price</th>
                    <th className="px-2 py-2 font-medium w-16 text-center">Sale</th>
                    <th className="px-3 py-2 font-medium text-right w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {horses.map((horse) => {
                    const ed = getEdit(horse.id, horse);
                    const isDirty = edits.has(horse.id);
                    const isBeingEdited = editingHorse?.id === horse.id;
                    const rarityDef = getRarity(horse.rarity ?? "common");
                    return (
                      <tr key={horse.id} className={isBeingEdited ? "bg-primary/5 border-l-2 border-primary" : isDirty ? "bg-amber-950" : "hover:bg-muted/20"}>
                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums text-xs">{horse.id}</td>
                        <td className="px-2 py-1.5">
                          <SpriteRenderer
                            spriteKey={horse.baseSpriteKey ?? null}
                            animation="idle"
                            size={24}
                            fallbackBase={horse.visualBase ?? "brown"}
                            fallbackPattern={horse.visualPattern ?? "none"}
                            fallbackFlair={horse.visualFlair ?? "none"}
                            tackColor={horse.tackColor ?? null}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={ed.name} onChange={(e) => setEdit(horse.id, "name", e.target.value)}
                            className="w-full bg-transparent border-b border-border focus:border-primary outline-none text-sm text-foreground py-0.5" />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                            style={{ color: rarityDef.color, background: rarityDef.bg, border: `1px solid ${rarityDef.border}` }}>
                            {rarityDef.label}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <span className="text-xs font-mono font-bold text-amber-400">
                            {horse.avgStat ?? "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-sm">
                          {horse.ownerName
                            ? <span className="text-green-400 font-medium text-xs">{horse.ownerName}</span>
                            : <span className="text-zinc-600 text-xs">—</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          {(() => {
                            const draft = priceEdits.get(horse.id);
                            const val = draft !== undefined ? draft : (horse.price != null ? String(horse.price) : "");
                            const isDirtyPrice = draft !== undefined;
                            return (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  placeholder="—"
                                  value={val}
                                  onChange={(e) => setPriceEdits((prev) => { const next = new Map(prev); next.set(horse.id, e.target.value); return next; })}
                                  onKeyDown={(e) => { if (e.key === "Enter") saveHorsePrice(horse); }}
                                  className="w-20 bg-transparent border-b border-border focus:border-amber-400 outline-none text-xs text-foreground py-0.5 tabular-nums"
                                />
                                {isDirtyPrice && (
                                  <button
                                    onClick={() => saveHorsePrice(horse)}
                                    disabled={savingPriceId === horse.id}
                                    className="text-xs px-1.5 py-0.5 bg-amber-900 hover:bg-amber-800 text-amber-400 border border-amber-700 rounded disabled:opacity-40">
                                    {savingPriceId === horse.id ? "…" : "Set"}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => {
                              const newSale = !horse.isForSale;
                              if (newSale && (!horse.price || horse.price <= 0)) {
                                flash("Set a price first before listing for sale.", false);
                                return;
                              }
                              apiFetch("/admin/horses/set-price", "POST", {
                                id: horse.id,
                                price: newSale ? horse.price : null,
                              }).then(() => loadHorses()).catch(() => {});
                            }}
                            title={horse.isForSale ? "Listed for sale — click to delist" : "Not for sale — click to list"}
                            className={`text-xs px-2 py-0.5 rounded-full border font-bold transition-colors ${
                              horse.isForSale
                                ? "bg-green-900 border-green-600 text-green-400 hover:bg-red-900 hover:border-red-600 hover:text-red-400"
                                : "bg-zinc-800 border-zinc-600 text-zinc-500 hover:bg-green-950 hover:border-green-700 hover:text-green-400"
                            }`}>
                            {horse.isForSale ? "✓" : "—"}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canManageHorses && (
                              <button
                                onClick={() => {
                                  setEditingHorse(horse);
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                className={`text-xs px-2 py-1 border rounded-lg flex items-center gap-1 whitespace-nowrap transition-colors ${
                                  isBeingEdited
                                    ? "bg-primary/20 border-primary text-primary"
                                    : "bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground border-border"
                                }`}
                              >
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                            )}
                            <button onClick={() => setAssignHorse(horse)}
                              className="text-xs px-2 py-1 bg-muted hover:bg-muted/60 text-muted-foreground hover:text-foreground border border-border rounded-lg whitespace-nowrap">
                              Owner
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-border flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{horses.length} horses</span>
              <button onClick={saveHorses} disabled={saving || edits.size === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded-lg disabled:opacity-40">
                <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </div>

      {assignHorse && (
        <AssignOwnerModal horse={assignHorse} onClose={() => setAssignHorse(null)} onAssigned={loadHorses} />
      )}
    </div>
  );
}
