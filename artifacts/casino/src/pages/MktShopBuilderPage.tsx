import { useState } from "react";
import {
  Save, Plus, X, ChevronDown, Palette, Layout,
  Star, Package, Megaphone,
} from "lucide-react";
import { ITEMS, CAT_COLOR, fmt, type Category } from "./mkt-shared";
import { useDeleteStall, DeleteStallModal, DeleteStallButton } from "./MktDeleteStall";

/* ── Types ────────────────────────────────────────────────────── */
type LayoutStyle = "Grid" | "Showcase" | "Minimal";
interface ShopConfig {
  name:         string;
  description:  string;

  avatar:       string;
  accent:       string;
  bannerStyle:  string;
  layout:       LayoutStyle;
  featuredIds:  number[];
  sections:     string[];
  announcement: string;
}

/* ── Constants ────────────────────────────────────────────────── */
const AVATAR_OPTIONS = ["👟","🃏","⌚","📱","👕","🌀","🏆","💎","🔥","⚡","🎯","🛡️","👑","🎰","💰"];

const ACCENT_PRESETS = [
  { label: "Casino Red",   value: "#e8400a" },
  { label: "Gold",        value: "#f5c518" },
  { label: "Purple",      value: "#a855f7" },
  { label: "Cyan",        value: "#06b6d4" },
  { label: "Orange",      value: "#f97316" },
  { label: "Green",       value: "#22c55e" },
  { label: "Blue",        value: "#60a5fa" },
  { label: "Pink",        value: "#ec4899" },
];

const BANNER_PRESETS = [
  { label: "Deep Red",    value: "linear-gradient(135deg,#1a0800 0%,#3d1200 50%,#1a0800 100%)" },
  { label: "Dark Blue",   value: "linear-gradient(135deg,#000d1a 0%,#001e3d 50%,#000d1a 100%)" },
  { label: "Dark Gold",   value: "linear-gradient(135deg,#1a1400 0%,#332900 50%,#1a1400 100%)" },
  { label: "Cyan Depths", value: "linear-gradient(135deg,#000e14 0%,#001e2a 50%,#000e14 100%)" },
  { label: "Deep Purple", value: "linear-gradient(135deg,#0e0014 0%,#1e0035 50%,#0e0014 100%)" },
  { label: "Ember",       value: "linear-gradient(135deg,#1a0000 0%,#2d0000 50%,#1a0000 100%)" },
  { label: "Midnight",    value: "linear-gradient(135deg,#050303 0%,#0d0b0b 50%,#050303 100%)" },
];

const LAYOUT_OPTIONS: { id: LayoutStyle; label: string; desc: string; icon: string }[] = [
  { id: "Grid",     label: "Grid",     desc: "Uniform card grid — great for high volume listings", icon: "▦" },
  { id: "Showcase", label: "Showcase", desc: "Hero feature + supporting items — best for premium pieces", icon: "▣" },
  { id: "Minimal",  label: "Minimal",  desc: "Clean list view — focused and distraction-free", icon: "≡" },
];

const SECTION_PRESETS = ["New Drops","Best Sellers","Rare Finds","Featured","Clearance","Exclusives","Graded Only","Limited Qty"];

/* ── Sub-components ───────────────────────────────────────────── */
function SectionLabel({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={14} style={{ color: "rgba(255,255,255,0.4)" }} />
      <span className="font-rajdhani text-[11px] font-black uppercase tracking-[0.12em]"
        style={{ color: "rgba(255,255,255,0.4)" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function FormInput({ label, value, onChange, placeholder, prefix }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; prefix?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-wider mb-1.5"
        style={{ color: "rgba(255,255,255,0.4)" }}>{label}</label>
      <div className="flex items-center rounded-xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        {prefix && (
          <span className="px-3 text-[11px]" style={{ color: "rgba(255,255,255,0.25)", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
            {prefix}
          </span>
        )}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-[12px] bg-transparent"
          style={{ color: "rgba(255,255,255,0.8)", outline: "none" }}
        />
      </div>
    </div>
  );
}

function FormTextarea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-wider mb-1.5"
        style={{ color: "rgba(255,255,255,0.4)" }}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full px-3 py-2 text-[12px] rounded-xl resize-none"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.8)", outline: "none" }}
      />
    </div>
  );
}

/* ── Save toast ───────────────────────────────────────────────── */
function SavedToast({ show }: { show: boolean }) {
  return (
    <div className="fixed bottom-8 right-8 flex items-center gap-2 px-4 py-3 rounded-xl text-[12px] font-black uppercase tracking-wide z-50"
      style={{
        background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)",
        color: "#22c55e", boxShadow: "0 0 20px rgba(34,197,94,0.3)",
        opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(12px)",
        transition: "all 0.3s", pointerEvents: "none",
      }}>
      ✓ Shop settings saved
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────── */
export function MktShopBuilderPage({ onDeleted }: { onDeleted?: () => void } = {}) {
  const [cfg, setCfg] = useState<ShopConfig>({
    name:         "Jonah's Vault",
    description:  "Hand-picked collectibles and rare finds. Every item personally vetted.",

    avatar:       "🏆",
    accent:       "#f97316",
    bannerStyle:  BANNER_PRESETS[0].value,
    layout:       "Grid",
    featuredIds:  [11, 14],
    sections:     ["Rare Finds", "Best Sellers"],
    announcement: "✨ New arrivals every Friday — check back weekly.",
  });
  const [saved, setSaved]             = useState(false);
  const [showDeleteModal, setShowDel] = useState(false);
  const { deleting, deleted, error, deleteStall, reset } = useDeleteStall();

  // Navigate away as soon as deletion is confirmed
  if (deleted) {
    onDeleted?.();
  }

  function update<K extends keyof ShopConfig>(key: K, val: ShopConfig[K]) {
    setCfg(prev => ({ ...prev, [key]: val }));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const availableItems = ITEMS.filter(i => !cfg.featuredIds.includes(i.id));

  return (
    <div className="relative w-full min-h-full" style={{ background: "#050303" }}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{ position: "absolute", top: 60, left: "25%", width: 400, height: 300, background: `radial-gradient(ellipse,${cfg.accent}06 0%,transparent 70%)`, filter: "blur(50px)" }} />
      </div>

      <div className="relative z-10 w-full max-w-[1100px] mx-auto px-6 pt-8 pb-16">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-orbitron text-white text-2xl font-black uppercase tracking-widest">Stall Settings</h1>
            <p className="text-[12px] mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>Customize your public shop page and seller profile</p>
          </div>
          <div className="flex items-center gap-2">

            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-[12px] font-black uppercase tracking-wide"
              style={{ color: "#fff", background: "linear-gradient(135deg,#e8400a,#c43209)", boxShadow: "0 0 18px rgba(232,64,10,0.45)", transition: "box-shadow 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 28px rgba(232,64,10,0.65)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 18px rgba(232,64,10,0.45)"; }}
            >
              <Save size={13} /> Save Changes
            </button>
          </div>
        </div>

        {/* Live preview banner */}
        <div className="rounded-2xl overflow-hidden mb-8" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="relative flex items-end px-6 pb-4" style={{ height: 100, background: cfg.bannerStyle }}>
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 30% 50%,${cfg.accent}14 0%,transparent 70%)` }} />
            <div className="flex items-end gap-4 relative z-10">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                style={{ background: "#0c0a0a", border: `2px solid ${cfg.accent}66`, boxShadow: `0 0 16px ${cfg.accent}44` }}>
                {cfg.avatar}
              </div>
              <div className="pb-1">
                <h2 className="font-orbitron text-white text-base font-black uppercase tracking-widest leading-none">
                  {cfg.name || "Your Shop Name"}
                </h2>
                <p className="text-[10px] mt-1" style={{ color: cfg.accent }}>by Jonah_Hydell</p>
              </div>
            </div>
            <span className="absolute top-3 right-4 text-[9px] uppercase tracking-widest font-black px-2 py-[3px] rounded"
              style={{ color: "rgba(255,255,255,0.35)", background: "rgba(0,0,0,0.4)" }}>Live Preview</span>
          </div>
          {cfg.announcement && (
            <div className="px-4 py-2.5 text-[11px] font-bold"
              style={{ background: `${cfg.accent}0d`, borderTop: `1px solid ${cfg.accent}22`, color: "rgba(255,255,255,0.7)" }}>
              {cfg.announcement}
            </div>
          )}
        </div>

        {/* Two-column layout */}
        <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 1fr" }}>

          {/* Left column */}
          <div className="flex flex-col gap-6">

            {/* Basic Info */}
            <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <SectionLabel label="Shop Info" icon={Package} />
              <div className="flex flex-col gap-4">
                <FormInput label="Shop Name" value={cfg.name} onChange={v => update("name", v)} placeholder="Your shop name" />
                <FormTextarea label="Description" value={cfg.description} onChange={v => update("description", v)} placeholder="Tell buyers about your shop..." />
              </div>
            </div>

            {/* Branding */}
            <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <SectionLabel label="Branding" icon={Palette} />

              {/* Avatar picker */}
              <div className="mb-5">
                <label className="block text-[10px] font-black uppercase tracking-wider mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Shop Avatar</label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.map(a => (
                    <button key={a} onClick={() => update("avatar", a)}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-xl"
                      style={{
                        background: cfg.avatar === a ? `${cfg.accent}20` : "rgba(255,255,255,0.04)",
                        border: cfg.avatar === a ? `2px solid ${cfg.accent}60` : "1px solid rgba(255,255,255,0.08)",
                        boxShadow: cfg.avatar === a ? `0 0 10px ${cfg.accent}40` : "none",
                        transition: "all 0.15s",
                      }}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Accent color */}
              <div className="mb-5">
                <label className="block text-[10px] font-black uppercase tracking-wider mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Accent Color</label>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_PRESETS.map(p => (
                    <button key={p.value} onClick={() => update("accent", p.value)}
                      className="w-7 h-7 rounded-lg"
                      style={{
                        background: p.value,
                        border: cfg.accent === p.value ? `2px solid #fff` : "2px solid transparent",
                        boxShadow: cfg.accent === p.value ? `0 0 12px ${p.value}80` : "none",
                        transition: "all 0.15s",
                      }}
                      title={p.label}
                    />
                  ))}
                </div>
              </div>

              {/* Banner style */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider mb-2"
                  style={{ color: "rgba(255,255,255,0.4)" }}>Banner Style</label>
                <div className="flex flex-wrap gap-2">
                  {BANNER_PRESETS.map(b => (
                    <button key={b.value} onClick={() => update("bannerStyle", b.value)}
                      className="h-8 rounded-lg flex items-end px-2 pb-1 text-[8px] font-black uppercase tracking-wider"
                      style={{
                        width: 80, background: b.value,
                        border: cfg.bannerStyle === b.value ? `2px solid rgba(255,255,255,0.6)` : "1px solid rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.6)", transition: "border-color 0.15s",
                      }}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Pinned Announcement */}
            <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <SectionLabel label="Pinned Announcement" icon={Megaphone} />
              <FormTextarea label="Message" value={cfg.announcement} onChange={v => update("announcement", v)} placeholder="Pin a message to the top of your shop (optional)..." />
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6">

            {/* Layout Style */}
            <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <SectionLabel label="Layout Style" icon={Layout} />
              <div className="flex flex-col gap-2">
                {LAYOUT_OPTIONS.map(l => {
                  const active = cfg.layout === l.id;
                  return (
                    <button key={l.id} onClick={() => update("layout", l.id)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-left"
                      style={{
                        background: active ? `${cfg.accent}12` : "rgba(255,255,255,0.03)",
                        border: active ? `1px solid ${cfg.accent}45` : "1px solid rgba(255,255,255,0.07)",
                        boxShadow: active ? `0 0 14px ${cfg.accent}20` : "none",
                        transition: "all 0.15s",
                      }}>
                      <span className="text-xl" style={{ color: active ? cfg.accent : "rgba(255,255,255,0.3)" }}>{l.icon}</span>
                      <div>
                        <p className="text-[12px] font-black uppercase tracking-wide"
                          style={{ color: active ? "#fff" : "rgba(255,255,255,0.55)" }}>{l.label}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{l.desc}</p>
                      </div>
                      {active && <div className="ml-auto w-2 h-2 rounded-full" style={{ background: cfg.accent, boxShadow: `0 0 6px ${cfg.accent}` }} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Featured Item Slots */}
            <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <SectionLabel label="Featured Item Slots" icon={Star} />
              <p className="text-[10px] mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>Pin up to 3 items to the top of your shop.</p>

              {/* Current featured */}
              <div className="flex flex-col gap-2 mb-3">
                {cfg.featuredIds.map(id => {
                  const item = ITEMS.find(i => i.id === id);
                  if (!item) return null;
                  return (
                    <div key={id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <span style={{ fontSize: 20 }}>{item.emoji}</span>
                      <p className="text-[11px] text-white font-bold flex-1 line-clamp-1">{item.name}</p>
                      <span className="text-[11px] font-black" style={{ color: "#f5c518" }}>{fmt(item.price)}</span>
                      <button onClick={() => update("featuredIds", cfg.featuredIds.filter(f => f !== id))}
                        className="w-5 h-5 rounded flex items-center justify-center"
                        style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", transition: "all 0.15s" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.3)"; }}
                      ><X size={10} /></button>
                    </div>
                  );
                })}
              </div>

              {/* Add item */}
              {cfg.featuredIds.length < 3 && (
                <div className="relative">
                  <ChevronDown size={11} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(255,255,255,0.35)" }} />
                  <select
                    value=""
                    onChange={e => {
                      const id = Number(e.target.value);
                      if (id && !cfg.featuredIds.includes(id)) update("featuredIds", [...cfg.featuredIds, id]);
                    }}
                    className="w-full appearance-none px-3 py-2 rounded-lg text-[11px]"
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px dashed ${cfg.accent}40`, color: cfg.accent, outline: "none", cursor: "pointer" }}
                  >
                    <option value="">+ Add featured item...</option>
                    {availableItems.map(i => (
                      <option key={i.id} value={i.id}>{i.emoji} {i.name} — {fmt(i.price)}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Custom Sections */}
            <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <SectionLabel label="Custom Shop Sections" icon={Layout} />
              <p className="text-[10px] mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>Organize your listings into named sections.</p>

              <div className="flex flex-col gap-2 mb-3">
                {cfg.sections.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <span className="text-[11px] text-white font-bold flex-1">{s}</span>
                    <button onClick={() => update("sections", cfg.sections.filter((_, j) => j !== i))}
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", transition: "all 0.15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.3)"; }}
                    ><X size={10} /></button>
                  </div>
                ))}
              </div>

              {/* Presets */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {SECTION_PRESETS.filter(p => !cfg.sections.includes(p)).map(p => (
                  <button key={p} onClick={() => update("sections", [...cfg.sections, p])}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold"
                    style={{ color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)", transition: "all 0.15s" }}
                    onMouseEnter={e => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.color = cfg.accent;
                      b.style.borderColor = `${cfg.accent}50`;
                    }}
                    onMouseLeave={e => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.color = "rgba(255,255,255,0.45)";
                      b.style.borderColor = "rgba(255,255,255,0.12)";
                    }}
                  >
                    <Plus size={9} />{p}
                  </button>
                ))}
              </div>
            </div>

            {/* Danger Zone */}
            <DeleteStallButton onClick={() => { reset(); setShowDel(true); }} />

          </div>
        </div>

        {/* Bottom save button */}
        <div className="flex justify-end mt-8">
          <button onClick={handleSave}
            className="flex items-center gap-2 px-8 py-3 rounded-xl text-[13px] font-black uppercase tracking-wide"
            style={{ color: "#fff", background: "linear-gradient(135deg,#e8400a,#c43209)", boxShadow: "0 0 22px rgba(232,64,10,0.45)", transition: "box-shadow 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 34px rgba(232,64,10,0.65)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 22px rgba(232,64,10,0.45)"; }}
          >
            <Save size={14} /> Save Changes
          </button>
        </div>
      </div>

      <SavedToast show={saved} />

      {showDeleteModal && (
        <DeleteStallModal
          stallName={cfg.name}
          deleting={deleting}
          error={error}
          onConfirm={() => deleteStall("jonahs-vault", cfg.name)}
          onCancel={() => { setShowDel(false); reset(); }}
        />
      )}
    </div>
  );
}
