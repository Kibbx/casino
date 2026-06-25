import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { fmtETDateTimeFull, fmtETDateTime, isoToETDatetimeLocal, etDatetimeLocalToISO } from "../utils/timezone";

const fmt = (n: number) => Number(n).toLocaleString();

function fmtDate(iso: string) {
  if (!iso) return "—";
  return fmtETDateTimeFull(iso);
}

interface Settings {
  enabled: boolean; ticketCost: number; maxTicketsPerPlayer: number;
  houseSplitPercent: number; jackpotSplitPercent: number; consolationSplitPercent: number;
  startingJackpot: number; numberMin: number; numberMax: number;
  numbersPerTicket: number; allowDuplicates: boolean; orderMatters: boolean;
  drawHour: number; drawMinute: number; ticketCloseMinutes: number;
  rolloverEnabled: boolean; jackpotRollover: number; consolationRollover: number;
}

export function LotteryTab() {
  const { bankerToken, sessionToken } = useStore();
  const token = bankerToken || sessionToken || "";

  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    return fetch(`${BASE}/api/lottery${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
    });
  }, [token]);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeDraw, setActiveDraw] = useState<any>(null);
  const [drawPlayers, setDrawPlayers] = useState<any[]>([]);
  const [drawPayouts, setDrawPayouts] = useState<any[]>([]);
  const [drawList, setDrawList] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [subTab, setSubTab] = useState<"overview" | "settings" | "draws" | "logs">("overview");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [drawDatetimeLocal, setDrawDatetimeLocal] = useState("");
  const [form, setForm] = useState<any>({});

  const loadSettings = useCallback(async () => {
    try {
      const r = await apiFetch("/settings");
      const d = await r.json();
      setSettings(d);
      setForm({
        enabled: d.enabled, ticketCost: d.ticketCost, maxTicketsPerPlayer: d.maxTicketsPerPlayer,
        houseSplitPercent: d.houseSplitPercent, jackpotSplitPercent: d.jackpotSplitPercent,
        consolationSplitPercent: d.consolationSplitPercent, startingJackpot: d.startingJackpot,
        numberMin: d.numberMin, numberMax: d.numberMax, numbersPerTicket: d.numbersPerTicket,
        allowDuplicates: d.allowDuplicates, orderMatters: d.orderMatters,
        drawHour: d.drawHour, drawMinute: d.drawMinute, ticketCloseMinutes: d.ticketCloseMinutes,
        rolloverEnabled: d.rolloverEnabled,
      });
      // Prefill datetime picker from settings (next Sunday at draw hour/minute UTC)
      setDrawDatetimeLocal(prev => {
        if (prev) return prev; // already set by active draw
        const now = new Date();
        const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(d.drawHour), Number(d.drawMinute)));
        const day = base.getUTCDay();
        base.setUTCDate(base.getUTCDate() + (day === 0 ? 0 : 7 - day));
        const min24 = new Date(now.getTime() + 24 * 3600000);
        if (base <= min24) base.setUTCDate(base.getUTCDate() + 7);
        return isoToETDatetimeLocal(base.toISOString());
      });
    } catch {}
  }, [apiFetch]);

  const loadActiveDetail = useCallback(async () => {
    try {
      const r = await apiFetch("/draws/active-detail");
      const d = await r.json();
      const draw = d.draw ?? null;
      setActiveDraw(draw);
      setDrawPlayers(d.players ?? []);
      setDrawPayouts(d.payouts ?? []);
      // Sync datetime picker to active draw's scheduled time
      if (draw?.draw_time) {
        setDrawDatetimeLocal(isoToETDatetimeLocal(draw.draw_time));
      }
    } catch {}
  }, [apiFetch]);

  const loadDrawList = useCallback(async () => {
    try {
      const r = await apiFetch("/draws/list");
      const d = await r.json();
      if (Array.isArray(d)) setDrawList(d);
    } catch {}
  }, [apiFetch]);

  const loadLogs = useCallback(async () => {
    try {
      const r = await apiFetch("/logs?limit=100");
      const d = await r.json();
      if (Array.isArray(d)) setLogs(d);
    } catch {}
  }, [apiFetch]);

  useEffect(() => {
    loadSettings();
    loadActiveDetail();
  }, [loadSettings, loadActiveDetail]);

  useEffect(() => {
    if (subTab === "draws") { loadDrawList(); }
    if (subTab === "logs") { loadLogs(); }
  }, [subTab, loadDrawList, loadLogs]);

  async function handleSaveSettings() {
    setSaving(true); setSaveMsg(null);
    const total = Number(form.houseSplitPercent) + Number(form.jackpotSplitPercent) + Number(form.consolationSplitPercent);
    if (total !== 100) { setSaveMsg({ text: "Split percentages must total 100%", ok: false }); setSaving(false); return; }
    try {
      // Extract UTC hour/minute from the ET datetime picker for storage
      let submitForm = { ...form };
      if (drawDatetimeLocal) {
        const utc = new Date(etDatetimeLocalToISO(drawDatetimeLocal));
        submitForm.drawHour = utc.getUTCHours();
        submitForm.drawMinute = utc.getUTCMinutes();
      }
      const r = await apiFetch("/settings", { method: "POST", body: JSON.stringify(submitForm) });
      const d = await r.json();
      if (!r.ok) { setSaveMsg({ text: d.error || "Failed", ok: false }); return; }
      // Also reschedule active draw if open
      if (activeDraw && drawDatetimeLocal && ["open", "sales_closed"].includes(activeDraw.status)) {
        const iso = etDatetimeLocalToISO(drawDatetimeLocal);
        await apiFetch(`/draws/${activeDraw.id}/reschedule`, { method: "POST", body: JSON.stringify({ drawTime: iso }) });
      }
      setSaveMsg({ text: "Settings saved", ok: true });
      loadSettings();
      loadActiveDetail();
    } catch { setSaveMsg({ text: "Network error", ok: false }); }
    finally { setSaving(false); }
  }

  async function handleCreateDraw() {
    setActionLoading(true); setActionMsg(null);
    try {
      const body: any = {};
      if (drawDatetimeLocal) body.drawTime = etDatetimeLocalToISO(drawDatetimeLocal);
      const r = await apiFetch("/draws/create", { method: "POST", body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setActionMsg({ text: d.error || "Failed", ok: false }); }
      else { setActionMsg({ text: `Draw #${d.drawId} created`, ok: true }); loadActiveDetail(); loadSettings(); }
    } catch { setActionMsg({ text: "Network error", ok: false }); }
    finally { setActionLoading(false); }
  }

  async function handleRescheduleDraw() {
    if (!activeDraw || !drawDatetimeLocal) return;
    setActionLoading(true); setActionMsg(null);
    try {
      const iso = etDatetimeLocalToISO(drawDatetimeLocal);
      const r = await apiFetch(`/draws/${activeDraw.id}/reschedule`, { method: "POST", body: JSON.stringify({ drawTime: iso }) });
      const d = await r.json();
      if (!r.ok) setActionMsg({ text: d.error || "Failed", ok: false });
      else { setActionMsg({ text: "Draw rescheduled", ok: true }); loadActiveDetail(); }
    } catch { setActionMsg({ text: "Network error", ok: false }); }
    finally { setActionLoading(false); }
  }

  async function handleForceDraw() {
    if (!activeDraw) return;
    if (!confirm("Force draw NOW? This will close sales and generate winning numbers immediately.")) return;
    setActionLoading(true); setActionMsg(null);
    try {
      const r = await apiFetch(`/draws/${activeDraw.id}/force-draw`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setActionMsg({ text: d.error || "Failed", ok: false }); }
      else { setActionMsg({ text: d.message || "Draw started", ok: true }); setTimeout(loadActiveDetail, 3000); }
    } catch { setActionMsg({ text: "Network error", ok: false }); }
    finally { setActionLoading(false); }
  }

  const splitTotal = Number(form.houseSplitPercent || 0) + Number(form.jackpotSplitPercent || 0) + Number(form.consolationSplitPercent || 0);
  const splitOk = splitTotal === 100;

  const cardStyle: React.CSSProperties = { background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "16px 18px", marginBottom: 14 };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em" };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", borderRadius: 7, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box" };
  const btnStyle = (color: string): React.CSSProperties => ({
    padding: "9px 20px", borderRadius: 8, background: color, border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
  });

  const subTabs = [
    { id: "overview", label: "Overview" },
    { id: "settings", label: "Settings" },
    { id: "draws", label: "Draw History" },
    { id: "logs", label: "Logs" },
  ] as const;

  return (
    <div style={{ background: "#0d0d18", minHeight: 400, borderRadius: 12, padding: "20px" }}>
      <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fbbf24", marginBottom: 18 }}>
        Lottery Management
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 0 }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id as any)}
            style={{ padding: "8px 18px", borderRadius: "8px 8px 0 0", background: subTab === t.id ? "rgba(251,191,36,0.12)" : "transparent", border: subTab === t.id ? "1px solid rgba(251,191,36,0.3)" : "1px solid transparent", borderBottom: "none", color: subTab === t.id ? "#fbbf24" : "rgba(255,255,255,0.4)", fontWeight: 700, fontSize: 12, cursor: "pointer", letterSpacing: "0.05em" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {subTab === "overview" && (
        <div>
          {/* Active Draw Card */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#fbbf24", fontFamily: "Oswald, sans-serif", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Active Draw {activeDraw ? `#${activeDraw.id}` : ""}
              </div>
              {activeDraw && (
                <span style={{ padding: "2px 10px", borderRadius: 20, background: activeDraw.status === "open" ? "rgba(34,197,94,0.15)" : "rgba(251,191,36,0.15)", border: `1px solid ${activeDraw.status === "open" ? "rgba(34,197,94,0.3)" : "rgba(251,191,36,0.3)"}`, color: activeDraw.status === "open" ? "#86efac" : "#fbbf24", fontSize: 11, fontWeight: 700 }}>
                  {activeDraw.status.toUpperCase().replace("_", " ")}
                </span>
              )}
            </div>

            {!activeDraw ? (
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 16 }}>No active draw.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
                {[
                  ["Jackpot", fmt(Number(activeDraw.final_jackpot)) + " chips"],
                  ["Consolation Pool", fmt(Number(activeDraw.final_consolation)) + " chips"],
                  ["Tickets Sold", activeDraw.total_tickets_purchased],
                  ["Submitted", activeDraw.total_submitted],
                  ["House Profit", fmt(Number(activeDraw.house_profit)) + " chips"],
                  ["Chips Collected", fmt(Number(activeDraw.total_chips_collected)) + " chips"],
                  ["Ticket Close", fmtDate(activeDraw.ticket_close_at)],
                  ["Draw Time", fmtDate(activeDraw.draw_time)],
                ].map(([l, v]) => (
                  <div key={l as string} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{l}</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#fff" }}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {activeDraw ? "Reschedule Draw (ET)" : "Draw Date & Time (ET)"}
                  </div>
                  <input type="datetime-local" value={drawDatetimeLocal} onChange={e => setDrawDatetimeLocal(e.target.value)}
                    style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 13, outline: "none" }} />
                </div>
                {!activeDraw && (
                  <button onClick={handleCreateDraw} disabled={actionLoading} style={{ ...btnStyle("rgba(34,197,94,0.7)"), marginTop: 18 }}>
                    {actionLoading ? "Creating..." : "Create Draw"}
                  </button>
                )}
                {activeDraw && activeDraw.status !== "complete" && activeDraw.status !== "drawing" && (
                  <button onClick={handleRescheduleDraw} disabled={actionLoading} style={{ ...btnStyle("rgba(99,102,241,0.7)"), marginTop: 18 }}>
                    {actionLoading ? "Saving..." : "Reschedule"}
                  </button>
                )}
                {activeDraw && activeDraw.status !== "complete" && activeDraw.status !== "drawing" && (
                  <button onClick={handleForceDraw} disabled={actionLoading} style={{ ...btnStyle("rgba(239,68,68,0.7)"), marginTop: 18 }}>
                    {actionLoading ? "Processing..." : "Force Draw Now"}
                  </button>
                )}
              </div>
              <button onClick={loadActiveDetail} style={{ ...btnStyle("rgba(255,255,255,0.08)"), marginTop: 18 }}>Refresh</button>
            </div>
            {actionMsg && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 7, background: actionMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${actionMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, color: actionMsg.ok ? "#86efac" : "#fca5a5", fontSize: 13 }}>
                {actionMsg.text}
              </div>
            )}
          </div>

          {/* Current rollover */}
          {settings && settings.jackpotRollover > 0 && (
            <div style={{ ...cardStyle, border: "1px solid rgba(251,191,36,0.3)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#fbbf24", marginBottom: 6 }}>Pending Jackpot Rollover</div>
              <div style={{ fontSize: 15, color: "#fbbf24", fontWeight: 700 }}>{fmt(settings.jackpotRollover)} chips</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>This amount will be applied to the next draw's jackpot when it's created.</div>
            </div>
          )}

          {/* Player ticket breakdown */}
          {drawPlayers.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "rgba(255,255,255,0.7)" }}>Player Ticket Breakdown</div>
              <div style={{ maxHeight: 240, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "rgba(255,255,255,0.4)", textAlign: "left" }}>
                      <th style={{ padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Player</th>
                      <th style={{ padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>Total</th>
                      <th style={{ padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>Submitted</th>
                      <th style={{ padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>Draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawPlayers.map((p: any) => (
                      <tr key={p.player_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "6px 8px", color: "#fff" }}>{p.player_username}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "#fff" }}>{p.ticket_count}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "#86efac" }}>{p.submitted}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "#818cf8" }}>{p.draft}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent payouts */}
          {drawPayouts.length > 0 && (
            <div style={cardStyle}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "rgba(255,255,255,0.7)" }}>Payouts This Draw</div>
              {drawPayouts.map((p: any) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap", gap: 6 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{p.player_username}</span>
                    <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 12, background: p.tier === "jackpot" ? "rgba(251,191,36,0.15)" : "rgba(34,197,94,0.1)", color: p.tier === "jackpot" ? "#fbbf24" : "#86efac", fontSize: 10, fontWeight: 700 }}>{p.tier.toUpperCase()}</span>
                  </div>
                  <div style={{ fontWeight: 700, color: "#fbbf24" }}>+{fmt(Number(p.payout_amount))} chips</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {subTab === "settings" && (
        <div>
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: "rgba(255,255,255,0.8)" }}>Lottery Configuration</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <div style={labelStyle}>Lottery Enabled</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.enabled} onChange={e => setForm((f: any) => ({ ...f, enabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  <span style={{ color: form.enabled ? "#86efac" : "rgba(255,255,255,0.4)", fontSize: 13 }}>{form.enabled ? "Enabled" : "Disabled"}</span>
                </label>
              </div>
              <div>
                <div style={labelStyle}>Rollover Enabled</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.rolloverEnabled} onChange={e => setForm((f: any) => ({ ...f, rolloverEnabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{form.rolloverEnabled ? "Yes" : "No"}</span>
                </label>
              </div>
              <div>
                <div style={labelStyle}>Ticket Cost (chips)</div>
                <input type="number" value={form.ticketCost ?? ""} onChange={e => setForm((f: any) => ({ ...f, ticketCost: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Max Tickets Per Player</div>
                <input type="number" value={form.maxTicketsPerPlayer ?? ""} onChange={e => setForm((f: any) => ({ ...f, maxTicketsPerPlayer: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Starting Jackpot (chips)</div>
                <input type="number" value={form.startingJackpot ?? ""} onChange={e => setForm((f: any) => ({ ...f, startingJackpot: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 10, marginTop: 4 }}>Prize Split</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 4 }}>
              <div>
                <div style={labelStyle}>House %</div>
                <input type="number" min={0} max={100} value={form.houseSplitPercent ?? ""} onChange={e => setForm((f: any) => ({ ...f, houseSplitPercent: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Jackpot %</div>
                <input type="number" min={0} max={100} value={form.jackpotSplitPercent ?? ""} onChange={e => setForm((f: any) => ({ ...f, jackpotSplitPercent: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Consolation %</div>
                <input type="number" min={0} max={100} value={form.consolationSplitPercent ?? ""} onChange={e => setForm((f: any) => ({ ...f, consolationSplitPercent: e.target.value }))} style={inputStyle} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: splitOk ? "#86efac" : "#fca5a5", marginBottom: 14 }}>
              Total: {splitTotal}% {splitOk ? "✓" : "(must equal 100%)"}
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>Number Rules</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <div style={labelStyle}>Number Min</div>
                <input type="number" value={form.numberMin ?? ""} onChange={e => setForm((f: any) => ({ ...f, numberMin: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Number Max</div>
                <input type="number" value={form.numberMax ?? ""} onChange={e => setForm((f: any) => ({ ...f, numberMax: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Numbers Per Ticket</div>
                <input type="number" value={form.numbersPerTicket ?? ""} onChange={e => setForm((f: any) => ({ ...f, numbersPerTicket: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={labelStyle}>Allow Duplicates</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.allowDuplicates} onChange={e => setForm((f: any) => ({ ...f, allowDuplicates: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{form.allowDuplicates ? "Yes" : "No"}</span>
                </label>
              </div>
              <div>
                <div style={labelStyle}>Order Matters</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.orderMatters} onChange={e => setForm((f: any) => ({ ...f, orderMatters: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{form.orderMatters ? "Yes" : "No"}</span>
                </label>
              </div>
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>Draw Schedule</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={labelStyle}>Draw Date & Time (ET)</div>
                <input type="datetime-local" value={drawDatetimeLocal} onChange={e => setDrawDatetimeLocal(e.target.value)} style={inputStyle} />
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>Saves weekly time for auto-scheduling. Also reschedules the active draw.</div>
              </div>
              <div>
                <div style={labelStyle}>Ticket Close (min before draw)</div>
                <input type="number" min={1} value={form.ticketCloseMinutes ?? ""} onChange={e => setForm((f: any) => ({ ...f, ticketCloseMinutes: e.target.value }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={handleSaveSettings} disabled={saving || !splitOk} style={btnStyle("rgba(34,197,94,0.7)")}>
                {saving ? "Saving..." : "Save Settings"}
              </button>
            </div>
            {saveMsg && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 7, background: saveMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${saveMsg.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, color: saveMsg.ok ? "#86efac" : "#fca5a5", fontSize: 13 }}>
                {saveMsg.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DRAW HISTORY ── */}
      {subTab === "draws" && (
        <div>
          {drawList.length === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 32 }}>No draws yet.</div>
          ) : drawList.map((d: any) => (
            <div key={d.id} style={{ ...cardStyle }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Draw #{d.id}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{fmtDate(d.draw_time)}</span>
                  <span style={{ padding: "2px 8px", borderRadius: 12, background: d.status === "complete" ? "rgba(34,197,94,0.1)" : "rgba(251,191,36,0.1)", color: d.status === "complete" ? "#86efac" : "#fbbf24", fontSize: 10, fontWeight: 700 }}>{d.status.toUpperCase()}</span>
                </div>
              </div>
              {d.winning_numbers && (
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Winning:</span>
                  {JSON.parse(d.winning_numbers).map((n: number) => (
                    <span key={n} style={{ width: 28, height: 28, borderRadius: 6, background: "#fbbf2422", border: "1px solid #fbbf24", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fbbf24", fontWeight: 700, fontSize: 12 }}>{n}</span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                <span>Jackpot: <b style={{ color: "#fbbf24" }}>{fmt(Number(d.final_jackpot))}</b></span>
                <span>Consolation: <b style={{ color: "#22c55e" }}>{fmt(Number(d.final_consolation))}</b></span>
                <span>Tickets: <b style={{ color: "#fff" }}>{d.total_tickets_purchased}</b></span>
                <span>Submitted: <b style={{ color: "#60a5fa" }}>{d.total_submitted}</b></span>
                <span>House: <b style={{ color: "#f97316" }}>{fmt(Number(d.house_profit))}</b></span>
                {d.jackpot_rolled_over && <span style={{ color: "#fbbf24", fontWeight: 700 }}>JACKPOT ROLLED OVER</span>}
                {d.consolation_rolled_into_jackpot && <span style={{ color: "#a5b4fc", fontWeight: 700 }}>CONSOLATION → JACKPOT</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── LOGS ── */}
      {subTab === "logs" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button onClick={loadLogs} style={btnStyle("rgba(99,102,241,0.5)")}>Refresh</button>
          </div>
          {logs.length === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 32 }}>No logs yet.</div>
          ) : (
            <div style={{ maxHeight: 500, overflowY: "auto" }}>
              {logs.map((l: any) => (
                <div key={l.id} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <span style={{ color: "rgba(255,255,255,0.3)", minWidth: 140, flexShrink: 0 }}>{fmtETDateTime(l.created_at)}</span>
                  {l.draw_id && <span style={{ color: "rgba(255,255,255,0.35)" }}>Draw #{l.draw_id}</span>}
                  <span style={{ color: "#a5b4fc", fontWeight: 700 }}>{l.action_type}</span>
                  <span style={{ color: "rgba(255,255,255,0.5)", wordBreak: "break-all" }}>{typeof l.details === "string" ? l.details : JSON.stringify(l.details)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
