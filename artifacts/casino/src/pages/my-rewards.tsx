import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { fmtETDateTime } from "../utils/timezone";
import { ChevronLeft, Package, Coins, Clock, CheckCircle2, Hourglass, Trash2, Tag } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface InventoryItem {
  id: number;
  prize_item_id: number;
  prize_name: string;
  prize_emoji: string;
  prize_type: string;
  quantity: number;
  image_url: string | null;
  tier: string | null;
  source: string | null;
  first_won_at: string;
  last_won_at: string;
  prize_value: number;
}

interface Reward {
  id: number;
  game: string;
  prize_type: "chips" | "item" | "bet" | "gems";
  prize_name: string;
  prize_emoji: string;
  chips_amount: number;
  won_at: string;
  delivered_at: string | null;
  delivered_by: string | null;
  notes: string | null;
}

function fmtDate(iso: string) {
  try { return fmtETDateTime(iso); } catch { return iso; }
}

const TIER_COLORS: Record<string, string> = {
  jackpot: "#f59e0b",
  legendary: "#a855f7",
  epic: "#ec4899",
  rare: "#3b82f6",
  common: "#6b7280",
};

const TIER_LABELS: Record<string, string> = {
  jackpot: "JACKPOT",
  legendary: "LEGENDARY",
  epic: "EPIC",
  rare: "RARE",
  common: "COMMON",
};

export default function MyRewardsPage() {
  const [, setLocation] = useLocation();
  const { sessionToken, setChips } = useStore();
  const [activeTab, setActiveTab] = useState<"inventory" | "history">("inventory");

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [invLoading, setInvLoading] = useState(true);

  const [rewards, setRewards] = useState<Reward[]>([]);
  const [histLoading, setHistLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // confirm state: itemId → "trash" | "sell"
  const [confirmState, setConfirmState] = useState<Record<number, "trash" | "sell">>({});
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!sessionToken) { setLocation("/login"); return; }

    fetch(`${BASE}/api/cases/my-inventory`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then((r) => r.json())
      .then((d) => setInventory(Array.isArray(d) ? d : []))
      .catch(() => setError("Failed to load inventory"))
      .finally(() => setInvLoading(false));

    fetch(`${BASE}/api/prizes/my-rewards`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then((r) => r.json())
      .then((d) => setRewards(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, [sessionToken]);

  const pending = rewards.filter((r) => !r.delivered_at);
  const delivered = rewards.filter((r) => r.delivered_at);

  function fmt(n: number) { return n.toLocaleString(); }

  function removeOrDecrementItem(id: number) {
    setInventory(prev => prev
      .map(item => item.id === id ? { ...item, quantity: item.quantity - 1 } : item)
      .filter(item => item.quantity > 0)
    );
  }

  async function handleTrash(item: InventoryItem) {
    if (confirmState[item.id] !== "trash") {
      setConfirmState(s => ({ ...s, [item.id]: "trash" }));
      return;
    }
    setActionLoading(item.id);
    try {
      const r = await fetch(`${BASE}/api/cases/my-inventory/${item.id}/trash`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      removeOrDecrementItem(item.id);
      setActionMsg({ text: `Trashed ${item.prize_name}.`, ok: true });
    } catch (e: any) {
      setActionMsg({ text: e.message, ok: false });
    } finally {
      setActionLoading(null);
      setConfirmState(s => { const n = { ...s }; delete n[item.id]; return n; });
      setTimeout(() => setActionMsg(null), 3000);
    }
  }

  async function handleSell(item: InventoryItem) {
    if (confirmState[item.id] !== "sell") {
      setConfirmState(s => ({ ...s, [item.id]: "sell" }));
      return;
    }
    setActionLoading(item.id);
    try {
      const r = await fetch(`${BASE}/api/cases/my-inventory/${item.id}/sell`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed");
      removeOrDecrementItem(item.id);
      if (d.newBalance !== undefined) setChips(d.newBalance);
      setActionMsg({ text: `Sold ${item.prize_name} for ${fmt(d.chipsAwarded)} chips!`, ok: true });
    } catch (e: any) {
      setActionMsg({ text: e.message, ok: false });
    } finally {
      setActionLoading(null);
      setConfirmState(s => { const n = { ...s }; delete n[item.id]; return n; });
      setTimeout(() => setActionMsg(null), 3000);
    }
  }

  function cancelConfirm(id: number) {
    setConfirmState(s => { const n = { ...s }; delete n[id]; return n; });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12", color: "#fff", fontFamily: "sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.4)" }}>
        <button
          onClick={() => setLocation("/lobby")}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 14, padding: 4 }}
        >
          <ChevronLeft size={18} /> Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Package size={20} style={{ color: "#a78bfa" }} />
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "0.04em" }}>My Inventory</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)" }}>
        {(["inventory", "history"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              flex: 1, padding: "12px 0", fontSize: 13, fontWeight: 600,
              background: "transparent", border: "none", cursor: "pointer",
              color: activeTab === id ? "#fff" : "rgba(255,255,255,0.4)",
              borderBottom: activeTab === id ? "2px solid #7c3aed" : "2px solid transparent",
              transition: "color 0.15s",
            }}
          >
            {id === "inventory" ? "Items" : "Prize History"}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px" }}>
        {/* Action toast */}
        {actionMsg && (
          <div style={{
            background: actionMsg.ok ? "rgba(74,222,128,0.12)" : "rgba(239,68,68,0.12)",
            border: `1px solid ${actionMsg.ok ? "rgba(74,222,128,0.35)" : "rgba(239,68,68,0.35)"}`,
            borderRadius: 10, padding: "10px 16px", color: actionMsg.ok ? "#4ade80" : "#fca5a5",
            fontSize: 13, fontWeight: 600, marginBottom: 14, textAlign: "center",
          }}>
            {actionMsg.text}
          </div>
        )}

        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "12px 16px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* INVENTORY TAB */}
        {activeTab === "inventory" && (
          <>
            {invLoading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>Loading inventory…</div>
            ) : inventory.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <Package size={48} style={{ color: "rgba(255,255,255,0.1)", margin: "0 auto 12px" }} />
                <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>No items yet. Open a case to start collecting!</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 12 }}>
                {inventory.map((item) => {
                  const tierColor = TIER_COLORS[item.tier ?? "common"] ?? TIER_COLORS.common;
                  const sellAmt = Math.floor((item.prize_value ?? 0) * 0.5);
                  const canSell = sellAmt > 0;
                  const isLoading = actionLoading === item.id;
                  const confirm = confirmState[item.id];

                  return (
                    <div
                      key={item.id}
                      style={{
                        background: "rgba(255,255,255,0.04)", borderRadius: 12,
                        border: `1px solid ${tierColor}40`,
                        overflow: "hidden", position: "relative",
                        display: "flex", flexDirection: "column",
                      }}
                    >
                      {/* Tier badge */}
                      <div style={{
                        position: "absolute", top: 6, left: 6, zIndex: 1,
                        background: tierColor + "22", border: `1px solid ${tierColor}55`,
                        borderRadius: 4, padding: "1px 5px", fontSize: 9, fontWeight: 700,
                        color: tierColor, letterSpacing: "0.06em",
                      }}>
                        {TIER_LABELS[item.tier ?? "common"] ?? "ITEM"}
                      </div>

                      {/* Quantity badge */}
                      {item.quantity > 1 && (
                        <div style={{
                          position: "absolute", top: 6, right: 6, zIndex: 1,
                          background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: 6, padding: "1px 6px", fontSize: 11, fontWeight: 700, color: "#fff",
                        }}>
                          x{item.quantity}
                        </div>
                      )}

                      {/* Image or emoji */}
                      <div style={{
                        width: "100%", height: 100, display: "flex", alignItems: "center", justifyContent: "center",
                        background: `linear-gradient(135deg, ${tierColor}10, transparent)`,
                      }}>
                        {item.image_url ? (
                          <img src={`${BASE}/api/uploads${item.image_url}`} alt={item.prize_name} style={{ maxWidth: "80%", maxHeight: 80, objectFit: "contain" }} />
                        ) : (
                          <span style={{ fontSize: 42 }}>{item.prize_emoji}</span>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ padding: "8px 10px 6px", flex: 1 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 2, lineHeight: 1.3 }}>{item.prize_name}</p>
                        {item.source && (
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 2 }}>From: {item.source}</p>
                        )}
                        {canSell && (
                          <p style={{ fontSize: 10, color: "#fbbf24", display: "flex", alignItems: "center", gap: 3 }}>
                            <Tag size={9} /> Sell value: {fmt(sellAmt)} chips
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
                        {confirm ? (
                          /* Confirmation row */
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textAlign: "center", margin: 0 }}>
                              {confirm === "sell" ? `Sell for ${fmt(sellAmt)} chips?` : "Trash this item?"}
                            </p>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                disabled={isLoading}
                                onClick={() => confirm === "sell" ? handleSell(item) : handleTrash(item)}
                                style={{
                                  flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 700,
                                  background: confirm === "sell" ? "rgba(74,222,128,0.2)" : "rgba(239,68,68,0.2)",
                                  border: `1px solid ${confirm === "sell" ? "rgba(74,222,128,0.5)" : "rgba(239,68,68,0.5)"}`,
                                  borderRadius: 6, color: confirm === "sell" ? "#4ade80" : "#f87171",
                                  cursor: isLoading ? "not-allowed" : "pointer",
                                  opacity: isLoading ? 0.5 : 1,
                                }}
                              >
                                {isLoading ? "…" : "Confirm"}
                              </button>
                              <button
                                disabled={isLoading}
                                onClick={() => cancelConfirm(item.id)}
                                style={{
                                  padding: "5px 10px", fontSize: 11, fontWeight: 700,
                                  background: "rgba(255,255,255,0.06)",
                                  border: "1px solid rgba(255,255,255,0.15)",
                                  borderRadius: 6, color: "rgba(255,255,255,0.5)",
                                  cursor: "pointer",
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Normal action buttons */
                          <div style={{ display: "flex", gap: 5 }}>
                            {canSell && (
                              <button
                                onClick={() => handleSell(item)}
                                style={{
                                  flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 700,
                                  background: "rgba(251,191,36,0.12)",
                                  border: "1px solid rgba(251,191,36,0.35)",
                                  borderRadius: 6, color: "#fbbf24",
                                  cursor: "pointer", display: "flex", alignItems: "center",
                                  justifyContent: "center", gap: 4,
                                }}
                              >
                                <Coins size={10} /> Sell
                              </button>
                            )}
                            <button
                              onClick={() => handleTrash(item)}
                              style={{
                                flex: canSell ? "0 0 auto" : 1,
                                padding: canSell ? "5px 8px" : "5px 0",
                                fontSize: 11, fontWeight: 700,
                                background: "rgba(239,68,68,0.08)",
                                border: "1px solid rgba(239,68,68,0.25)",
                                borderRadius: 6, color: "rgba(239,68,68,0.7)",
                                cursor: "pointer", display: "flex", alignItems: "center",
                                justifyContent: "center", gap: 4,
                              }}
                            >
                              <Trash2 size={10} />{!canSell && " Trash"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <>
            {histLoading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>Loading history…</div>
            ) : rewards.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px" }}>
                <Package size={48} style={{ color: "rgba(255,255,255,0.1)", margin: "0 auto 12px" }} />
                <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>No prize history yet.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pending.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 2px" }}>
                      <Hourglass size={14} style={{ color: "#fbbf24" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.06em", textTransform: "uppercase" }}>Pending Delivery ({pending.length})</span>
                    </div>
                    {pending.map((r) => <RewardRow key={r.id} r={r} />)}
                    {delivered.length > 0 && <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "8px 0" }} />}
                  </>
                )}
                {delivered.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 2px" }}>
                      <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#4ade80", letterSpacing: "0.06em", textTransform: "uppercase" }}>Delivered ({delivered.length})</span>
                    </div>
                    {delivered.map((r) => <RewardRow key={r.id} r={r} />)}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RewardRow({ r }: { r: Reward }) {
  const isDelivered = !!r.delivered_at;
  const gameLabel = r.game === "wheel" ? "Prize Wheel" : r.game;
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px",
      border: `1px solid ${isDelivered ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)"}`,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{r.prize_emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{r.prize_name}</span>
          {r.prize_type === "chips" && r.chips_amount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>
              <Coins size={11} /> {r.chips_amount.toLocaleString()}
            </span>
          )}
          {r.prize_type === "gems" && r.chips_amount > 0 && (
            <span style={{ fontSize: 11, color: "#c084fc", fontWeight: 700 }}>
              💎 {r.chips_amount.toLocaleString()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "capitalize" }}>{gameLabel}</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>·</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            <Clock size={10} /> {fmtDate(r.won_at)}
          </span>
        </div>
        {isDelivered && r.delivered_by && (
          <div style={{ fontSize: 11, color: "#4ade80", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <CheckCircle2 size={10} /> Delivered by {r.delivered_by}
            {r.delivered_at && <span style={{ color: "rgba(255,255,255,0.35)" }}>· {fmtDate(r.delivered_at)}</span>}
          </div>
        )}
        {r.notes && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{r.notes}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>
        {isDelivered ? (
          <CheckCircle2 size={16} style={{ color: "#4ade80" }} />
        ) : (
          <Hourglass size={16} style={{ color: "#fbbf24" }} />
        )}
      </div>
    </div>
  );
}
