import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useStore } from "../store";
import { usePageTracker } from "../lib/usePageTracker";
import TournamentWestern from "./tournament-western";
import TournamentRome from "./tournament-rome";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface TournamentInfo {
  id: number;
  name: string;
  status: string;
  type: string;
  slotGame: string | null;
  minBet: number | null;
  maxBet: number | null;
  startingChips: number;
  endTime: string | null;
}

interface MyEntry {
  tournamentChips: number;
  score: number;
  status: string;
  biggestSpin: number;
}

interface LeaderboardRow {
  rank: number;
  playerName: string;
  score: number;
  biggestSpin: number;
  status: string;
}

export default function SlotsTournamentPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { sessionToken, playerId } = useStore();
  usePageTracker("slots-tournament", sessionToken);

  const tournamentId = parseInt(id);

  const [tournament, setTournament] = useState<TournamentInfo | null>(null);
  const [myEntry, setMyEntry]       = useState<MyEntry | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [showLeaderboard, setShowLeaderboard]   = useState(false);
  const [leaderboard, setLeaderboard]           = useState<LeaderboardRow[]>([]);
  const [lbLoading, setLbLoading]               = useState(false);

  useEffect(() => {
    if (!sessionToken) return;
    setLoading(true);
    fetch(`${BASE}/api/tournaments/${tournamentId}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => r.json())
      .then(t => {
        setTournament(t);
        if (playerId && Array.isArray(t.entries)) {
          const e = t.entries.find((en: any) => String(en.playerId) === String(playerId)) ?? null;
          setMyEntry(e);
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message ?? "Failed to load tournament");
        setLoading(false);
      });
  }, [tournamentId, sessionToken, playerId]);

  function openLeaderboard() {
    setShowLeaderboard(true);
    setLbLoading(true);
    fetch(`${BASE}/api/tournaments/${tournamentId}/leaderboard`, {
      headers: { Authorization: `Bearer ${sessionToken ?? ""}` },
    })
      .then(r => r.json())
      .then(d => { setLeaderboard(Array.isArray(d) ? d : (d.entries ?? d.leaderboard ?? [])); setLbLoading(false); })
      .catch(() => setLbLoading(false));
  }

  function handleBack() {
    navigate(`/tournament/${tournamentId}`);
  }

  if (loading) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0a0504", fontFamily: "Oswald,sans-serif", color: "rgba(200,160,40,0.7)", fontSize: 22, letterSpacing: "0.12em" }}>
        Loading tournament…
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#0a0504", gap: 20 }}>
        <div style={{ fontFamily: "Oswald,sans-serif", fontSize: 22, color: "#f87171", letterSpacing: "0.08em" }}>
          {error ?? "Tournament not found"}
        </div>
        <button onClick={() => navigate("/tournaments-page")} style={{ background: "rgba(139,37,0,0.4)", border: "1px solid rgba(200,80,40,0.5)",
          borderRadius: 8, color: "#FFD060", fontFamily: "Oswald,sans-serif", fontSize: 15, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 28px", cursor: "pointer" }}>
          ← Back
        </button>
      </div>
    );
  }

  if (!myEntry || myEntry.status === "registered") {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#0a0504", gap: 20 }}>
        <div style={{ fontFamily: "Oswald,sans-serif", fontSize: 22, color: "rgba(200,160,40,0.7)", letterSpacing: "0.08em" }}>
          You are not active in this tournament
        </div>
        <button onClick={handleBack} style={{ background: "rgba(139,37,0,0.4)", border: "1px solid rgba(200,80,40,0.5)",
          borderRadius: 8, color: "#FFD060", fontFamily: "Oswald,sans-serif", fontSize: 15, fontWeight: 700,
          letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 28px", cursor: "pointer" }}>
          ← Tournament Lobby
        </button>
      </div>
    );
  }

  const minBet = tournament.minBet ?? 20;
  const maxBet = tournament.maxBet ?? tournament.startingChips;
  const isWestern = tournament.slotGame === "western";

  const gameProps = {
    tournamentId,
    tournamentName: tournament.name,
    initialChips: myEntry.tournamentChips,
    initialScore: myEntry.score,
    endTime: tournament.endTime,
    minBet,
    maxBet,
    onBack: handleBack,
    onLeaderboard: openLeaderboard,
  };

  return (
    <>
      {isWestern
        ? <TournamentWestern {...gameProps} />
        : <TournamentRome {...gameProps} />
      }

      {/* Leaderboard modal */}
      {showLeaderboard && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowLeaderboard(false); }}>
          <div style={{ width: "min(560px,90vw)", maxHeight: "80vh", overflowY: "auto",
            background: isWestern ? "linear-gradient(180deg,rgba(30,12,4,0.99) 0%,rgba(15,6,2,0.99) 100%)"
                                  : "linear-gradient(180deg,rgba(12,4,20,0.99) 0%,rgba(6,2,12,0.99) 100%)",
            border: `2px solid ${isWestern ? "rgba(200,140,40,0.5)" : "rgba(185,28,28,0.5)"}`,
            borderRadius: 16, padding: "32px 36px", position: "relative",
            boxShadow: "0 0 60px rgba(0,0,0,0.8)" }}>
            <div style={{ fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 24, letterSpacing: "0.14em",
              color: isWestern ? "#FFD060" : "#fcd34d", textAlign: "center", textTransform: "uppercase", marginBottom: 20,
              textShadow: isWestern ? "0 0 16px rgba(255,200,40,0.4)" : "0 0 16px rgba(252,211,77,0.4)" }}>
              🏆 {tournament.name}
            </div>

            {lbLoading ? (
              <div style={{ textAlign: "center", padding: "30px 0", fontFamily: "Oswald,sans-serif",
                color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>Loading…</div>
            ) : leaderboard.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", fontFamily: "Oswald,sans-serif",
                color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>No entries yet</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {leaderboard.map((row, i) => {
                  const isTop3 = i < 3;
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12,
                      background: isTop3 ? "rgba(255,215,0,0.07)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${isTop3 ? "rgba(255,215,0,0.2)" : "rgba(255,255,255,0.07)"}`,
                      borderRadius: 8, padding: "10px 16px" }}>
                      <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 18, minWidth: 36,
                        color: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "rgba(255,255,255,0.35)",
                        textAlign: "center" }}>
                        {medal ?? `#${row.rank}`}
                      </span>
                      <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 16, flex: 1,
                        color: isTop3 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)", letterSpacing: "0.04em" }}>
                        {row.playerName}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                        <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 800, fontSize: 18,
                          color: isWestern ? "#FFD060" : "#fcd34d" }}>
                          {row.score.toLocaleString()}
                        </span>
                        {row.biggestSpin > 0 && (
                          <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 10,
                            color: "rgba(255,255,255,0.25)", letterSpacing: "0.06em" }}>
                            best: +{row.biggestSpin.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={() => setShowLeaderboard(false)}
              style={{ position: "absolute", right: 16, top: 14, width: 36, height: 36,
                background: "rgba(0,0,0,0.5)", border: `1px solid ${isWestern ? "rgba(200,140,40,0.4)" : "rgba(185,28,28,0.4)"}`,
                borderRadius: "50%", cursor: "pointer", color: isWestern ? "#FFD060" : "#fcd34d",
                fontFamily: "Oswald,sans-serif", fontSize: 20, fontWeight: 900,
                display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
        </div>
      )}
    </>
  );
}
