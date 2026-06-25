import { useState, useRef, useEffect, useCallback } from "react";
import { PlusCircle, X, Gift, MapPin, ArrowRightLeft, Coins, Search, RefreshCw } from "lucide-react";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tab = "deposit" | "transfer" | "promo";

interface PlayerHit {
  id: number;
  username: string;
  stateId: string | null;
}

export default function DepositInfo() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("deposit");
  const ref = useRef<HTMLDivElement>(null);
  const { sessionToken } = useStore();

  // Promo
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Transfer
  const [transferTo, setTransferTo] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerHit | null>(null);
  const [transferAmt, setTransferAmt] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult, setTransferResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [searchResults, setSearchResults] = useState<PlayerHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Debounced player search
  const searchPlayers = useCallback((q: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    searchTimeout.current = setTimeout(async () => {
      if (!sessionToken) return;
      setSearchLoading(true);
      try {
        const r = await fetch(`${BASE}/api/players/search?q=${encodeURIComponent(q)}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const d = await r.json();
        setSearchResults(Array.isArray(d) ? d : []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 280);
  }, [sessionToken]);

  function pickPlayer(p: PlayerHit) {
    setSelectedPlayer(p);
    setTransferTo(p.username);
    setShowDropdown(false);
    setSearchResults([]);
    setTransferResult(null);
  }

  function clearRecipient() {
    setSelectedPlayer(null);
    setTransferTo("");
    setSearchResults([]);
    setShowDropdown(false);
    setTransferResult(null);
  }

  async function redeemCode() {
    const trimmed = promoCode.trim();
    if (!trimmed || !sessionToken) return;
    setPromoLoading(true);
    setPromoResult(null);
    try {
      const r = await fetch(`${BASE}/api/promo/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ code: trimmed }),
      });
      const d = await r.json();
      if (!r.ok) {
        setPromoResult({ ok: false, text: d.error || "Failed to redeem code" });
      } else {
        const amt = d.rewardAmount?.toLocaleString() ?? "";
        setPromoResult({ ok: true, text: `Success! +${amt} chips added to your account.` });
        setPromoCode("");
      }
    } catch {
      setPromoResult({ ok: false, text: "Network error. Please try again." });
    } finally {
      setPromoLoading(false);
    }
  }

  async function doTransfer() {
    const toName = selectedPlayer?.username ?? transferTo.trim();
    const amt = parseInt(transferAmt);
    if (!toName || !amt || amt < 1 || !sessionToken) return;
    setTransferLoading(true);
    setTransferResult(null);
    try {
      const r = await fetch(`${BASE}/api/players/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ toUsername: toName, amount: amt }),
      });
      const d = await r.json();
      if (!r.ok) {
        setTransferResult({ ok: false, text: d.error || "Transfer failed" });
      } else {
        setTransferResult({ ok: true, text: `Sent ${amt.toLocaleString()} chips to ${toName}. Your new balance: ${d.newBalance?.toLocaleString()} chips.` });
        clearRecipient();
        setTransferAmt("");
      }
    } catch {
      setTransferResult({ ok: false, text: "Network error. Please try again." });
    } finally {
      setTransferLoading(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "deposit", label: "Deposit" },
    { id: "transfer", label: "Transfer" },
    { id: "promo", label: "Promo" },
  ];

  const canSend = !!(selectedPlayer || transferTo.trim()) && !!parseInt(transferAmt) && !transferLoading;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-white rounded-lg px-3 py-1.5 transition-all"
        style={{ background: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)", boxShadow: "0 2px 8px rgba(185,28,28,0.45)" }}
        title="Deposit / Transfer"
      >
        <PlusCircle className="w-3.5 h-3.5" />
        <span>Deposit</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 z-50 rounded-2xl"
          style={{ border: "1px solid rgba(255,255,255,0.12)", background: "#1a0f0f", boxShadow: "0 8px 40px rgba(0,0,0,0.8), 0 0 0 1px rgba(185,28,28,0.2)", overflow: "visible" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 rounded-t-2xl" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(185,28,28,0.15)" }}>
            <p className="text-sm font-bold uppercase tracking-widest text-white">Chips & Deposits</p>
            <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex-1 py-2 text-xs font-semibold transition-colors"
                style={{
                  color: tab === t.id ? "#fff" : "rgba(255,255,255,0.4)",
                  borderBottom: tab === t.id ? "2px solid #b91c1c" : "2px solid transparent",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="px-4 py-3">

            {/* DEPOSIT TAB */}
            {tab === "deposit" && (
              <div className="space-y-4">
                <div className="flex gap-4 items-start">
                  <span className="text-4xl leading-none mt-0.5">🏦</span>
                  <div className="space-y-1.5">
                    <p className="text-base font-bold text-white">Teller Window</p>
                    <p className="text-sm text-white/70 leading-relaxed">
                      All chip transactions are handled at the casino location.
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium mt-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span>South Side · Jamestown St · 348</span>
                    </div>
                    <p className="text-xs text-white/50 leading-relaxed mt-1">
                      Our staff at the teller window can assist with deposits, withdrawals, and chip purchases.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TRANSFER TAB */}
            {tab === "transfer" && (
              <div className="space-y-2">
                {/* Recipient */}
                <div className="relative">
                  {selectedPlayer ? (
                    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)" }}>
                      <span className="text-xs font-semibold text-white truncate flex-1">{selectedPlayer.username}</span>
                      {selectedPlayer.stateId && <span className="text-[10px] text-blue-400 shrink-0">#{selectedPlayer.stateId}</span>}
                      <button onClick={clearRecipient} className="text-white/30 hover:text-white transition-colors shrink-0 ml-1">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
                      <input
                        type="text"
                        value={transferTo}
                        onChange={(e) => { setTransferTo(e.target.value); setTransferResult(null); searchPlayers(e.target.value); }}
                        onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                        placeholder="Search player name…"
                        disabled={transferLoading}
                        className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-600 disabled:opacity-50"
                      />
                      {searchLoading && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/25">…</span>}
                    </div>
                  )}

                  {/* Dropdown */}
                  {showDropdown && !selectedPlayer && (
                    <div
                      className="absolute left-0 right-0 top-full mt-0.5 rounded-lg z-20"
                      style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 6px 20px rgba(0,0,0,0.8)", maxHeight: 180, overflowY: "auto" }}
                    >
                      {searchResults.length > 0 ? searchResults.map((p, i) => (
                        <button
                          key={p.id}
                          onClick={() => pickPlayer(p)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
                          style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none", minWidth: 0 }}
                        >
                          <span className="text-xs font-medium text-white flex-1" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.username}</span>
                          {p.stateId && <span className="text-[10px] text-white/35 shrink-0 pl-2">#{p.stateId}</span>}
                        </button>
                      )) : (
                        !searchLoading && transferTo.length >= 2 && (
                          <p className="px-3 py-2 text-[11px] text-white/35">No players found</p>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* Amount + Send */}
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Coins className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-amber-500 pointer-events-none" />
                    <input
                      type="number"
                      min={1}
                      value={transferAmt}
                      onChange={(e) => { setTransferAmt(e.target.value); setTransferResult(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && canSend) doTransfer(); }}
                      placeholder="Amount"
                      disabled={transferLoading}
                      className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-blue-600 disabled:opacity-50"
                    />
                  </div>
                  <button
                    onClick={doTransfer}
                    disabled={!canSend}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #1d4ed8, #1e40af)" }}
                  >
                    {transferLoading ? "…" : "Send"}
                  </button>
                </div>

                {transferResult && (
                  <p className={`text-[11px] leading-relaxed ${transferResult.ok ? "text-green-400" : "text-red-400"}`}>
                    {transferResult.text}
                  </p>
                )}
              </div>
            )}

            {/* PROMO TAB */}
            {tab === "promo" && (
              <div className="space-y-4">
                <div className="flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-amber-400" />
                  <p className="text-sm font-bold text-white">Promo Code</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") redeemCode(); }}
                    placeholder="ENTER CODE"
                    disabled={promoLoading}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 font-mono tracking-wider focus:outline-none focus:border-amber-600 disabled:opacity-50"
                  />
                  <button
                    onClick={redeemCode}
                    disabled={promoLoading || !promoCode.trim()}
                    className="px-4 py-2 rounded-lg text-sm font-bold text-black transition-all disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}
                  >
                    {promoLoading ? "…" : "Redeem"}
                  </button>
                </div>
                {promoResult && (
                  <p className={`text-xs leading-relaxed px-1 ${promoResult.ok ? "text-green-400" : "text-red-400"}`}>
                    {promoResult.text}
                  </p>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
