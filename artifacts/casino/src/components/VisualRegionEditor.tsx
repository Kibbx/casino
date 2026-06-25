import { useEffect, useRef, useState, useCallback } from "react";
import { Trash2, Check, X, Eye, Grid3x3, SlidersHorizontal } from "lucide-react";
import { showConfirm } from "../lib/confirm";

// ── Types ──────────────────────────────────────────────────────────────────────
export type Region = {
  id: number;
  name: string;
  pageKey: string;
  x: number; y: number; width: number; height: number;
  isActive: boolean;
  desktopVisible: boolean;
  mobileVisible: boolean;
};

type Rect = { x: number; y: number; w: number; h: number };

type Interaction =
  | { mode: "idle" }
  | { mode: "drawing"; sx: number; sy: number; cx: number; cy: number }
  | { mode: "moving"; id: number; startMX: number; startMY: number; origX: number; origY: number }
  | { mode: "resizing"; id: number; handle: string; startMX: number; startMY: number; orig: Rect };

// ── Constants ──────────────────────────────────────────────────────────────────
const HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
type Handle = typeof HANDLES[number];

const CURSOR_MAP: Record<Handle, string> = {
  n: "ns-resize", ne: "nesw-resize", e: "ew-resize", se: "nwse-resize",
  s: "ns-resize", sw: "nesw-resize", w: "ew-resize", nw: "nwse-resize",
};

/**
 * Reference viewport dimensions — must match the REF_W/REF_H in PromoRegion.tsx.
 * The editor renders the page in an iframe at this size then scales it to fit
 * the available panel width (responsive canvas).
 */
const REF_W = 1920;
const REF_H = 1080;
const ASPECT = REF_H / REF_W; // 0.5625 (16:9)

const PAGE_THEMES: Record<string, { bg: string; accent: string; label: string }> = {
  homepage:    { bg: "#1A1A2E", accent: "#F59E0B", label: "Home Page" },
  lobby:       { bg: "#0D1F0D", accent: "#22C55E", label: "Lobby" },
  roulette:    { bg: "#1A0D0D", accent: "#EF4444", label: "Roulette" },
  blackjack:   { bg: "#0D1A0D", accent: "#4ADE80", label: "Blackjack" },
  slots:       { bg: "#1A0D2E", accent: "#A78BFA", label: "Slots" },
  crash:       { bg: "#0D1A2E", accent: "#60A5FA", label: "Crash" },
  tournaments: { bg: "#1A1A0D", accent: "#FACC15", label: "Tournaments" },
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function pxToPct(px: number, dim: number) { return (px / dim) * 100; }
function pctToPx(pct: number, dim: number) { return (pct / 100) * dim; }

function normalizeRect(sx: number, sy: number, ex: number, ey: number): Rect {
  return { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) };
}

function handlePos(rect: Rect, handle: Handle) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const map: Record<Handle, [number, number]> = {
    n: [cx, rect.y], ne: [rect.x + rect.w, rect.y], e: [rect.x + rect.w, cy],
    se: [rect.x + rect.w, rect.y + rect.h], s: [cx, rect.y + rect.h],
    sw: [rect.x, rect.y + rect.h], w: [rect.x, cy], nw: [rect.x, rect.y],
  };
  return { left: map[handle][0], top: map[handle][1] };
}

function applyHandleDelta(orig: Rect, handle: string, dx: number, dy: number): Rect {
  let { x, y, w, h } = orig;
  if (handle.includes("e")) w = Math.max(4, w + dx);
  if (handle.includes("w")) { x = Math.min(x + w - 4, x + dx); w = Math.max(4, w - dx); }
  if (handle.includes("s")) h = Math.max(4, h + dy);
  if (handle.includes("n")) { y = Math.min(y + h - 4, y + dy); h = Math.max(4, h - dy); }
  return { x, y, w, h };
}

function fmt(pct: number, refDim: number) {
  return `${pct.toFixed(1)}% (~${Math.round((pct / 100) * refDim)}px)`;
}

function DimPanel({ rect, label, cw, ch }: { rect: Rect | null; label: string; cw: number; ch: number }) {
  if (!rect) return null;
  const xPct = pxToPct(rect.x, cw), yPct = pxToPct(rect.y, ch);
  const wPct = pxToPct(rect.w, cw), hPct = pxToPct(rect.h, ch);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono">
      <span className="text-zinc-600 font-sans text-[10px] uppercase tracking-widest mr-1 shrink-0">{label}</span>
      <span><span className="text-zinc-500">X:</span> <span className="text-amber-300">{fmt(xPct, REF_W)}</span></span>
      <span><span className="text-zinc-500">Y:</span> <span className="text-amber-300">{fmt(yPct, REF_H)}</span></span>
      <span><span className="text-zinc-500">W:</span> <span className="text-green-400">{fmt(wPct, REF_W)}</span></span>
      <span><span className="text-zinc-500">H:</span> <span className="text-green-400">{fmt(hPct, REF_H)}</span></span>
    </div>
  );
}

interface Props {
  regions: Region[];
  pageKey: string;
  onSave: (region: Omit<Region, "id" | "createdAt">, id?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function VisualRegionEditor({ regions, pageKey, onSave, onDelete }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Responsive canvas dimensions ─────────────────────────────────────────────
  // The canvas fills 100% of its container; height auto-tracks at 16:9 (1920×1080).
  const [cw, setCw] = useState(900);
  const ch = Math.round(cw * ASPECT);
  const scale = cw / REF_W;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.max(400, Math.floor(entry.contentRect.width));
      setCw(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [interaction, setInteraction] = useState<Interaction>({ mode: "idle" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftRect, setDraftRect] = useState<Rect | null>(null);
  const [regionName, setRegionName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [liveRects, setLiveRects] = useState<Record<number, Rect>>({});
  /** IDs with unsaved position/size changes (moved or resized but not yet committed) */
  const [unsavedIds, setUnsavedIds] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"preview" | "grid">("preview");
  const [previewOpacity, setPreviewOpacity] = useState(0.85);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const theme = PAGE_THEMES[pageKey] ?? PAGE_THEMES.lobby;
  const pageRegions = regions.filter(r => r.pageKey === pageKey);

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const previewUrl = `${BASE}/page-preview/${pageKey}`;

  useEffect(() => {
    setLiveRects({});
    setUnsavedIds(new Set());
    setSelectedId(null);
    setDraftRect(null);
    setInteraction({ mode: "idle" });
    setIframeLoaded(false);
    setSavedFlash(false);
  }, [pageKey]);

  function getCanvasPos(e: MouseEvent | React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clamp(e.clientX - rect.left, 0, cw), y: clamp(e.clientY - rect.top, 0, ch) };
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const pos = getCanvasPos(e);
    setSelectedId(null); setDraftRect(null); setRegionName("");
    setInteraction({ mode: "drawing", sx: pos.x, sy: pos.y, cx: pos.x, cy: pos.y });
  }

  function onRegionMouseDown(e: React.MouseEvent, id: number) {
    e.preventDefault(); e.stopPropagation();
    const pos = getCanvasPos(e);
    const r = pageRegions.find(r => r.id === id);
    if (!r) return;
    setSelectedId(id);
    setRegionName(r.name);
    setInteraction({ mode: "moving", id, startMX: pos.x, startMY: pos.y, origX: pctToPx(r.x, cw), origY: pctToPx(r.y, ch) });
  }

  function onHandleMouseDown(e: React.MouseEvent, id: number, handle: string) {
    e.preventDefault(); e.stopPropagation();
    const pos = getCanvasPos(e);
    const r = pageRegions.find(r => r.id === id);
    if (!r) return;
    setSelectedId(id);
    const orig: Rect = { x: pctToPx(r.x, cw), y: pctToPx(r.y, ch), w: pctToPx(r.width, cw), h: pctToPx(r.height, ch) };
    setInteraction({ mode: "resizing", id, handle, startMX: pos.x, startMY: pos.y, orig });
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (interaction.mode === "idle") return;
    const pos = getCanvasPos(e);
    if (interaction.mode === "drawing") {
      setInteraction(prev => prev.mode === "drawing" ? { ...prev, cx: pos.x, cy: pos.y } : prev);
    }
    if (interaction.mode === "moving") {
      const dx = pos.x - interaction.startMX, dy = pos.y - interaction.startMY;
      const r = pageRegions.find(r => r.id === interaction.id);
      const rw = r ? pctToPx(r.width, cw) : 0, rh = r ? pctToPx(r.height, ch) : 0;
      const nx = clamp(interaction.origX + dx, 0, cw - rw), ny = clamp(interaction.origY + dy, 0, ch - rh);
      setLiveRects(prev => ({ ...prev, [interaction.id]: { x: nx, y: ny, w: rw, h: rh } }));
    }
    if (interaction.mode === "resizing") {
      const dx = pos.x - interaction.startMX, dy = pos.y - interaction.startMY;
      const newRect = applyHandleDelta(interaction.orig, interaction.handle, dx, dy);
      newRect.x = clamp(newRect.x, 0, cw - 4); newRect.y = clamp(newRect.y, 0, ch - 4);
      newRect.w = Math.min(newRect.w, cw - newRect.x); newRect.h = Math.min(newRect.h, ch - newRect.y);
      setLiveRects(prev => ({ ...prev, [interaction.id]: newRect }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, pageRegions, cw, ch]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (interaction.mode === "idle") return;
    const pos = getCanvasPos(e);
    if (interaction.mode === "drawing") {
      const rect = normalizeRect(interaction.sx, interaction.sy, pos.x, pos.y);
      if (rect.w > 8 && rect.h > 8) setDraftRect(rect);
      setInteraction({ mode: "idle" }); return;
    }
    if (interaction.mode === "moving" || interaction.mode === "resizing") {
      const id = interaction.id;
      const lr = liveRects[id];
      // Mark as unsaved so the "Save Position" button appears — don't auto-save
      if (lr) setUnsavedIds(prev => new Set(prev).add(id));
    }
    setInteraction({ mode: "idle" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, liveRects]);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => { document.removeEventListener("mousemove", handleMouseMove); document.removeEventListener("mouseup", handleMouseUp); };
  }, [handleMouseMove, handleMouseUp]);

  async function saveDraft() {
    if (!draftRect || !regionName.trim()) return;
    setSaving(true);
    await onSave({ name: regionName.trim(), pageKey, x: pxToPct(draftRect.x, cw), y: pxToPct(draftRect.y, ch), width: pxToPct(draftRect.w, cw), height: pxToPct(draftRect.h, ch), isActive: true, desktopVisible: true, mobileVisible: false });
    setDraftRect(null); setRegionName(""); setSaving(false);
  }

  async function saveSelectedName() {
    if (!selectedId || !regionName.trim()) return;
    const r = pageRegions.find(r => r.id === selectedId);
    if (!r) return;
    setSaving(true);
    await onSave({ ...r, name: regionName.trim() }, selectedId);
    setSaving(false);
  }

  async function savePosition() {
    if (!selectedId) return;
    const r = pageRegions.find(r => r.id === selectedId);
    if (!r) return;
    const lr = liveRects[selectedId];
    if (!lr) return;
    setSaving(true);
    await onSave({
      ...r,
      x:      pxToPct(lr.x, cw),
      y:      pxToPct(lr.y, ch),
      width:  pxToPct(lr.w, cw),
      height: pxToPct(lr.h, ch),
    }, selectedId);
    // Clear unsaved marker and flash success
    setUnsavedIds(prev => { const s = new Set(prev); s.delete(selectedId); return s; });
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  let activeRect: Rect | null = null;
  let activeDimLabel = "";
  if (interaction.mode === "drawing") {
    activeRect = normalizeRect(interaction.sx, interaction.sy, interaction.cx, interaction.cy);
    activeDimLabel = "Drawing";
  } else if (selectedId !== null && liveRects[selectedId]) {
    activeRect = liveRects[selectedId];
    activeDimLabel = interaction.mode === "moving" ? "Moving" : interaction.mode === "resizing" ? "Resizing" : "Selected";
  } else if (draftRect) {
    activeRect = draftRect; activeDimLabel = "New Region";
  } else if (selectedId !== null) {
    const r = pageRegions.find(r => r.id === selectedId);
    if (r) { activeRect = { x: pctToPx(r.x, cw), y: pctToPx(r.y, ch), w: pctToPx(r.width, cw), h: pctToPx(r.height, ch) }; activeDimLabel = "Selected"; }
  }

  let drawingBox: Rect | null = null;
  if (interaction.mode === "drawing") {
    const r = normalizeRect(interaction.sx, interaction.sy, interaction.cx, interaction.cy);
    if (r.w > 2 || r.h > 2) drawingBox = r;
  }

  const selectedRegion = pageRegions.find(r => r.id === selectedId) ?? null;

  function renderRegionBox(region: Region) {
    const live = liveRects[region.id];
    const rx = live ? live.x : pctToPx(region.x, cw);
    const ry = live ? live.y : pctToPx(region.y, ch);
    const rw = live ? live.w : pctToPx(region.width, cw);
    const rh = live ? live.h : pctToPx(region.height, ch);
    const rect: Rect = { x: rx, y: ry, w: rw, h: rh };
    const isSelected = region.id === selectedId;
    const isDirty = unsavedIds.has(region.id);
    const accent = isDirty ? "#F59E0B" : isSelected ? "#F59E0B" : theme.accent;

    return (
      <div key={region.id} style={{ position: "absolute", left: rx, top: ry, width: rw, height: rh, userSelect: "none", zIndex: isSelected ? 20 : 10 }}>
        <div onMouseDown={e => onRegionMouseDown(e, region.id)} style={{ position: "absolute", inset: 0, border: `2px ${isDirty ? "solid" : "dashed"} ${accent}`, background: `${accent}${isDirty ? "30" : "20"}`, borderRadius: 4, cursor: "move" }}>
          <span style={{ position: "absolute", top: 4, left: 6, fontSize: 11, fontWeight: 700, color: accent, pointerEvents: "none", whiteSpace: "nowrap", maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 3px #000, 0 1px 3px #000" }}>
            {region.name}
          </span>
          {isDirty && (
            <span style={{ position: "absolute", top: 4, right: 6, fontSize: 9, color: "#F59E0B", fontWeight: 700, fontFamily: "monospace", textShadow: "0 1px 3px #000" }}>
              UNSAVED
            </span>
          )}
          {rw > 60 && rh > 30 && (
            <span style={{ position: "absolute", bottom: 3, right: 6, fontSize: 9, color: accent + "bb", pointerEvents: "none", fontFamily: "monospace", textShadow: "0 1px 3px #000" }}>
              {pxToPct(rw, cw).toFixed(1)}×{pxToPct(rh, ch).toFixed(1)}%
            </span>
          )}
        </div>
        {isSelected && HANDLES.map(h => {
          const hpos = handlePos(rect, h);
          return (
            <div key={h} onMouseDown={e => onHandleMouseDown(e, region.id, h)} style={{ position: "absolute", left: hpos.left - rx - 5, top: hpos.top - ry - 5, width: 10, height: 10, background: "#F59E0B", border: "2px solid #111", borderRadius: 2, cursor: CURSOR_MAP[h], zIndex: 30 }} />
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3 select-none" ref={containerRef}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 gap-0.5">
          <button onClick={() => setViewMode("preview")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === "preview" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
            <Eye className="w-3 h-3" /> Page Preview
          </button>
          <button onClick={() => setViewMode("grid")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === "grid" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
            <Grid3x3 className="w-3 h-3" /> Grid
          </button>
        </div>

        {viewMode === "preview" && (
          <div className="relative">
            <button onClick={() => setShowOpacitySlider(v => !v)} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-400 hover:text-zinc-200">
              <SlidersHorizontal className="w-3 h-3" /> Opacity {Math.round(previewOpacity * 100)}%
            </button>
            {showOpacitySlider && (
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg p-3 z-50 w-44">
                <input type="range" min={0.2} max={1} step={0.05} value={previewOpacity} onChange={e => setPreviewOpacity(+e.target.value)} className="w-full accent-amber-400" />
              </div>
            )}
          </div>
        )}

        {viewMode === "preview" && (
          <button
            onClick={() => { setPreviewKey(k => k + 1); setIframeLoaded(false); }}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
          >
            ↻ Refresh Preview
          </button>
        )}

        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600 font-mono">{REF_W}×{REF_H}</span>
        <span className="text-[10px] text-zinc-700 italic">Drag to draw · Click to select · Corner handles to resize</span>
      </div>

      {/* Canvas — fills container width, 16:9 height */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: ch,
          overflow: "hidden",
          borderRadius: 10,
          border: `2px solid ${viewMode === "preview" ? "#3f3f46" : theme.accent + "33"}`,
          cursor: "crosshair",
        }}
        ref={canvasRef}
        onMouseDown={onCanvasMouseDown}
      >
        {/* Background layer */}
        {viewMode === "preview" ? (
          <>
            {!iframeLoaded && (
              <div style={{ position: "absolute", inset: 0, background: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0 }}>
                <span style={{ fontSize: 12, color: theme.accent + "66", letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace" }}>Loading preview…</span>
              </div>
            )}
            {/* 1920×1080 page scaled to fill canvas width */}
            <iframe
              key={`${pageKey}-${previewKey}`}
              src={previewUrl}
              onLoad={() => setIframeLoaded(true)}
              tabIndex={-1}
              style={{
                position: "absolute", top: 0, left: 0,
                width: REF_W, height: REF_H,
                transform: `scale(${scale})`, transformOrigin: "0 0",
                border: "none", pointerEvents: "none", userSelect: "none",
                opacity: iframeLoaded ? previewOpacity : 0,
                transition: "opacity 0.3s", zIndex: 1,
              }}
            />
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, background: theme.bg, zIndex: 0 }}>
            {[25, 50, 75].map(p => (
              <div key={`v${p}`} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: `${theme.accent}12`, pointerEvents: "none" }} />
            ))}
            {[25, 50, 75].map(p => (
              <div key={`h${p}`} style={{ position: "absolute", top: `${p}%`, left: 0, right: 0, height: 1, background: `${theme.accent}12`, pointerEvents: "none" }} />
            ))}
            <div style={{ position: "absolute", top: 14, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: theme.accent + "55", letterSpacing: 3, textTransform: "uppercase" }}>{theme.label}</span>
            </div>
          </div>
        )}

        {/* Overlay — regions + drawing box */}
        <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
          {pageRegions.map(region => renderRegionBox(region))}

          {drawingBox && (
            <div style={{ position: "absolute", left: drawingBox.x, top: drawingBox.y, width: drawingBox.w, height: drawingBox.h, border: "2px dashed #F59E0B", background: "#F59E0B18", borderRadius: 4, pointerEvents: "none", zIndex: 40 }}>
              {drawingBox.w > 40 && drawingBox.h > 20 && (
                <span style={{ position: "absolute", bottom: 3, right: 5, fontSize: 9, color: "#F59E0B", fontFamily: "monospace", pointerEvents: "none", textShadow: "0 1px 3px #000" }}>
                  {pxToPct(drawingBox.w, cw).toFixed(1)}×{pxToPct(drawingBox.h, ch).toFixed(1)}%
                </span>
              )}
            </div>
          )}

          {draftRect && !drawingBox && (
            <div style={{ position: "absolute", left: draftRect.x, top: draftRect.y, width: draftRect.w, height: draftRect.h, border: "2px dashed #F59E0B", background: "#F59E0B22", borderRadius: 4, pointerEvents: "none", zIndex: 40 }}>
              <span style={{ position: "absolute", top: 4, left: 6, fontSize: 11, color: "#F59E0B", fontWeight: 700, textShadow: "0 1px 3px #000" }}>▶ Name this region</span>
            </div>
          )}
        </div>
      </div>

      <DimPanel rect={activeRect} label={activeDimLabel} cw={cw} ch={ch} />

      {draftRect && !drawingBox && (
        <div className="flex items-center gap-3 bg-card border border-amber-700 rounded-xl px-4 py-3">
          <span className="text-xs font-bold text-amber-400 shrink-0">Name new region:</span>
          <input autoFocus value={regionName} onChange={e => setRegionName(e.target.value)} onKeyDown={e => e.key === "Enter" && saveDraft()} placeholder="e.g. Top Banner" className="flex-1 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground" />
          <button onClick={saveDraft} disabled={saving || !regionName.trim()} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded-lg disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={() => { setDraftRect(null); setRegionName(""); }} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-xs rounded-lg flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}

      {selectedRegion && !draftRect && (
        <div className="space-y-2">
          {/* Save Position button — shown when the region has been moved/resized */}
          {unsavedIds.has(selectedRegion.id) && (
            <div className="flex items-center gap-3 bg-amber-950 border border-amber-600 rounded-xl px-4 py-3">
              <span className="text-amber-300 text-xs font-bold shrink-0">⚠ Unsaved position</span>
              <span className="text-amber-400 text-xs flex-1">Drag finished — click to commit the new location to the database.</span>
              <button
                onClick={savePosition}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-900 text-xs font-bold rounded-lg disabled:opacity-50 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? "Saving…" : "Save Position"}
              </button>
            </div>
          )}

          {/* Saved flash */}
          {savedFlash && !unsavedIds.has(selectedRegion.id) && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-950 border border-green-700 rounded-xl text-green-400 text-xs font-bold">
              <Check className="w-3.5 h-3.5" /> Position saved!
            </div>
          )}

          {/* Rename / delete row */}
          <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
            <span className="text-xs font-bold text-foreground shrink-0">Selected:</span>
            <input value={regionName} onChange={e => setRegionName(e.target.value)} onKeyDown={e => e.key === "Enter" && saveSelectedName()} placeholder="Region name" className="flex-1 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground" />
            <button onClick={saveSelectedName} disabled={saving || !regionName.trim() || regionName === selectedRegion.name} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-bold rounded-lg disabled:opacity-40">
              <Check className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Rename"}
            </button>
            <button onClick={() => { showConfirm(`Delete "${selectedRegion.name}"?`, () => onDelete(selectedRegion.id)); setSelectedId(null); }} className="flex items-center gap-1.5 px-3 py-1.5 border border-red-700 text-red-400 hover:bg-red-950 text-xs rounded-lg">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button onClick={() => setSelectedId(null)} className="text-zinc-500 hover:text-foreground px-1"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {!draftRect && !selectedRegion && !drawingBox && (
        <p className="text-xs text-zinc-600 italic text-center">
          {pageRegions.length === 0 ? "No regions on this page yet — drag on the canvas to draw the first one" : `${pageRegions.length} region${pageRegions.length !== 1 ? "s" : ""} on this page · click to select`}
        </p>
      )}
    </div>
  );
}
