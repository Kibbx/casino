import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useStore } from "../store";
import { Button, Input } from "../components/ui-elements";
import { useGetTable, useStartGame, useLeaveTable, useJoinTable, useGetPlayer } from "@workspace/api-client-react";
import { useWs } from "../lib/WsContext";
import { PokerTableVisual, PlayingCard, type LogEntry, type SeatActionProps } from "../components/poker";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Play, X, Wifi, WifiOff, Timer } from "lucide-react";
import { playSound } from "../lib/sounds";
import { useTableSocket } from "../lib/useTableSocket";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { PromoZone } from "../components/PromoRegion";

let logIdCounter = 1;
function makeLog(text: string, type: LogEntry["type"]): LogEntry {
  return { id: logIdCounter++, text, type };
}

const SUIT_SYMBOLS: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const RANK_NAMES: Record<string, string> = { A: "A", K: "K", Q: "Q", J: "J", T: "10" };
function formatCard(card: string): string {
  if (!card || card.length < 2) return card;
  const rank = card.slice(0, -1);
  const suit = card.slice(-1).toLowerCase();
  return `${RANK_NAMES[rank] ?? rank}${SUIT_SYMBOLS[suit] ?? suit}`;
}
function formatCards(cards: string[]): string {
  return cards.map(formatCard).join("  ");
}

export default function TablePage() {
  const params = useParams<{ tableId: string }>();
  const tableId = parseInt(params.tableId);
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("poker", sessionToken ?? null);
  const [raiseAmount, setRaiseAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [buyInAmount, setBuyInAmount] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [showYourTurn, setShowYourTurn] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [turnTimerSec, setTurnTimerSec] = useState<number | null>(null);
  const [usingTimebank, setUsingTimebank] = useState(false);
  const [localTurnStartedAt, setLocalTurnStartedAt] = useState<number | null>(null);
  const [removalReason, setRemovalReason] = useState<"afk" | "eliminated" | "bust" | null>(null);
  const [isReadying, setIsReadying] = useState(false);
  const [readyState, setReadyState] = useState<{ ready: boolean; readyCount: number; threshold: number; total: number } | null>(null);
  const [aloneCountdown, setAloneCountdown] = useState<number | null>(null);
  const [localBlindCountdown, setLocalBlindCountdown] = useState<number | null>(null);
  const [blindLevelFlash, setBlindLevelFlash] = useState(false);

  const autoFoldFiredRef = useRef(false);
  const isActingRef = useRef(false);
  const wasSeatedRef = useRef(false);
  const lastKnownChipsRef = useRef<number | null>(null);
  const prevPhase = useRef<string | null>(null);
  const prevCommunityCount = useRef(0);
  const prevCurrentSeat = useRef<number | null>(null);
  const prevWinner = useRef<any>(null);
  const prevSeatCount = useRef(0);
  const yourTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSeatBets = useRef<Record<number, number>>({});
  const prevSeatStatuses = useRef<Record<number, string>>({});
  const prevTableBet = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const hasLeftRef = useRef(false);
  const aloneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: restTable } = useGetTable(tableId);
  const { table: wsTable, connected: wsConnected, sendAction, blindInfo } = useTableSocket(tableId, playerId ?? null);
  const table = wsTable ?? restTable;
  const startMutation = useStartGame();
  const leaveMutation = useLeaveTable();
  const joinMutation = useJoinTable();
  const { data: player } = useGetPlayer(playerId!, {
    query: { enabled: !!playerId },
  });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));

  const mySeat = table?.seats.find((s: any) => s.playerId === playerId);
  const myCards: string[] = mySeat ? (table?.gameState?.playerHands?.[mySeat.seatIndex] ?? []) : [];
  const isMyTurn = !!(mySeat && table?.gameState?.currentPlayerSeat === mySeat.seatIndex && table?.status === "playing" && !table?.gameState?.winner);
  const canStart = false; // game auto-starts server-side once 2+ players are seated
  const canStartNewHand = false; // hands auto-deal server-side; button no longer needed
  const currentBet = table?.gameState?.currentBet ?? 0;
  const mySeatBet = mySeat?.currentBet ?? 0;
  const callAmount = Math.max(0, currentBet - mySeatBet);
  const myTimebankSec: number = (mySeat as any)?.timebankSeconds ?? 15;
  const isTournamentTable = !!(table as any)?.tournamentId;
  const readyPlayerIds: number[] = (table as any)?.readyPlayerIds ?? [];
  const seatedPlayerIds: number[] = table?.seats.filter((s: any) => s.playerId).map((s: any) => s.playerId) ?? [];
  const validReadyCount = readyPlayerIds.filter((id) => seatedPlayerIds.includes(id)).length;
  const readyThreshold = Math.ceil(seatedPlayerIds.length * 0.75);
  const iAmReady = !!(playerId && readyPlayerIds.includes(playerId));

  async function handleReadyUp() {
    if (!playerId || !sessionToken || isReadying) return;
    setIsReadying(true);
    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${BASE}/api/tables/${tableId}/ready`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setReadyState(data);
      }
    } catch {}
    setIsReadying(false);
  }

  // Keep isActingRef current so the auto-fold useEffect can read it without a dep
  isActingRef.current = isActing;

  // Mirror current values into refs so cleanup callbacks see fresh data (no stale closures)
  const mySeatRef = useRef<any>(null);
  mySeatRef.current = mySeat;
  const playerIdRef = useRef<number | null>(null);
  playerIdRef.current = playerId ?? null;
  const sessionTokenRef = useRef<string | null>(null);
  sessionTokenRef.current = sessionToken ?? null;

  // ── Leave on back-button / tab close (cash tables only — tournament seats are permanent) ──
  const isTournamentTableRef = useRef(false);
  useEffect(() => {
    isTournamentTableRef.current = !!(table as any)?.tournamentId;
  });


  useEffect(() => {
    function fireLeave() {
      if (hasLeftRef.current) return;
      if (!playerIdRef.current || !mySeatRef.current) return;
      if (isTournamentTableRef.current) return; // tournament seats persist — never auto-leave
      hasLeftRef.current = true;
      fetch(`/api/tables/${tableId}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionTokenRef.current ?? ""}`,
        },
        body: JSON.stringify({ playerId: playerIdRef.current }),
        keepalive: true,
      }).catch(() => {});
    }
    window.addEventListener("beforeunload", fireLeave);
    return () => {
      window.removeEventListener("beforeunload", fireLeave);
      // Component unmount = React navigation (back button, route change, etc.)
      fireLeave();
    };
  }, [tableId]);

  // Quick raise presets
  const bigBlind = table?.bigBlind ?? 50;
  const pot = table?.gameState?.pot ?? 0;
  const myChips = mySeat?.chips ?? 0;
  const raisePresets = [
    { label: "¼ Pot", value: Math.max(bigBlind, Math.floor(pot / 4)) },
    { label: "½ Pot", value: Math.max(bigBlind, Math.floor(pot / 2)) },
    { label: "¾ Pot", value: Math.max(bigBlind, Math.floor(pot * 3 / 4)) },
    { label: "Pot", value: Math.max(bigBlind, pot) },
    { label: "All-In", value: myChips },
  ];

  // Chip denominations — only show chips the player can afford
  const ALL_CHIPS = [
    { value: 25,    label: "25",  bg: "#16a34a", ring: "#15803d" },
    { value: 100,   label: "100", bg: "#374151", ring: "#4b5563" },
    { value: 500,   label: "500", bg: "#7c3aed", ring: "#6d28d9" },
    { value: 1000,  label: "1K",  bg: "#dc2626", ring: "#b91c1c" },
    { value: 5000,  label: "5K",  bg: "#ea580c", ring: "#c2410c" },
    { value: 10000, label: "10K", bg: "#2563eb", ring: "#1d4ed8" },
    { value: 25000, label: "25K", bg: "#b45309", ring: "#92400e" },
  ];
  const visibleChips = ALL_CHIPS.filter(c => c.value <= myChips);

  const phaseLabels: Record<string, string> = {
    preflop: "Pre-Flop",
    flop: "The Flop",
    turn: "The Turn",
    river: "The River",
    showdown: "Showdown",
  };
  const phaseColor: Record<string, string> = {
    preflop: "bg-indigo-900 border-indigo-600 text-indigo-200",
    flop: "bg-emerald-900 border-emerald-600 text-emerald-200",
    turn: "bg-amber-900 border-amber-600 text-amber-200",
    river: "bg-red-900 border-red-600 text-red-200",
    showdown: "bg-yellow-900 border-yellow-600 text-yellow-200",
  };
  const phase = table?.gameState?.phase;

  // ── Action log tracking ──────────────────────────────────────────────────
  useEffect(() => {
    if (!table) return;
    const gs = table.gameState;
    const seats = table.seats;

    // Players joined/left (track seated count)
    const seatedNow = seats.filter((s: any) => s.playerId).length;
    if (seatedNow > prevSeatCount.current && prevSeatCount.current > 0) {
      const newest = seats.find((s: any) => s.playerId && !seats.slice(0, prevSeatCount.current).some((p: any) => p.playerId === s.playerId));
      if (newest) {
        setLog((l) => [...l, makeLog(`${newest.playerName} joined the table`, "info")]);
      }
    }
    prevSeatCount.current = seatedNow;

    if (!gs) return;

    const communityCount = gs.communityCards?.length ?? 0;

    // Phase changes
    const wasPhaseChange = gs.phase !== prevPhase.current;
    if (gs.phase && wasPhaseChange) {
      if (prevPhase.current === null) {
        // New hand starting — log deal + blinds
        const sbSeat = seats.find((s: any) => s.seatIndex === gs.smallBlindSeat);
        const bbSeat = seats.find((s: any) => s.seatIndex === gs.bigBlindSeat);
        setLog((l) => [
          ...l,
          makeLog(`New hand started`, "phase"),
          makeLog(`The preflop — Two cards dealt to each player`, "phase"),
          ...(sbSeat ? [makeLog(`SB ${sbSeat.playerName ?? "Player"} posted small blind $${table.smallBlind}`, "blind")] : []),
          ...(bbSeat ? [makeLog(`BB ${bbSeat.playerName ?? "Player"} posted big blind $${table.bigBlind}`, "blind")] : []),
        ]);
        playSound("deal");
      } else if (gs.phase === "flop") {
        setLog((l) => [...l, makeLog(`The flop: ${formatCards(gs.communityCards.slice(0, 3))}`, "phase")]);
        for (let i = 0; i < 3; i++) setTimeout(() => playSound("newCard"), i * 120);
      } else if (gs.phase === "turn") {
        setLog((l) => [...l, makeLog(`The turn: ${formatCard(gs.communityCards[3])}`, "phase")]);
        playSound("newCard");
      } else if (gs.phase === "river") {
        setLog((l) => [...l, makeLog(`The river: ${formatCard(gs.communityCards[4])}`, "phase")]);
        playSound("newCard");
      }
      prevPhase.current = gs.phase;
      prevCommunityCount.current = communityCount;
    }

    // Winners (single or split pot)
    if (gs.winners?.length && !prevWinner.current) {
      const iWon = gs.winners.some((w: any) => w.seatIndex === mySeat?.seatIndex);
      const entries = gs.winners.map((w: any) => {
        const holeCards: string[] = gs.playerHands?.[w.seatIndex] ?? [];
        const cardStr = holeCards.length ? ` [${formatCards(holeCards)}]` : "";
        const text = gs.winners.length > 1
          ? `${w.playerName} splits ${w.amount.toLocaleString()} chips — ${w.handDescription}${cardStr}`
          : `${w.playerName} wins ${w.amount.toLocaleString()} chips — ${w.handDescription}${cardStr}`;
        return makeLog(text, "win");
      });
      setLog((l) => [...l, ...entries]);
      playSound(iWon ? "win" : "lose");
      prevWinner.current = gs.winners[0];
    } else if (!gs.winners?.length) {
      prevWinner.current = null;
    }

    // Fold detection — scan ALL seats every update so folds are never missed
    // (turn-based detection misses folds that end a hand since phase changes simultaneously)
    if (Object.keys(prevSeatStatuses.current).length > 0) {
      const foldEntries: LogEntry[] = [];
      for (const seat of seats) {
        if (!seat.playerId) continue;
        const prevStatus = prevSeatStatuses.current[seat.seatIndex];
        const curStatus = seat.status ?? "sitting";
        if (prevStatus && prevStatus !== "folded" && curStatus === "folded") {
          const isMyOwnFold = seat.seatIndex === mySeat?.seatIndex;
          if (!isMyOwnFold) {
            foldEntries.push(makeLog(`${seat.playerName ?? "Player"} folded`, "action"));
          }
        }
      }
      if (foldEntries.length > 0) {
        setLog((l) => [...l, ...foldEntries]);
        playSound("fold");
      }
    }

    // Opponent action detection — check / call / raise (turn change, same phase only)
    const curSeat = gs.currentPlayerSeat ?? null;
    if (
      prevCurrentSeat.current !== null &&
      prevCurrentSeat.current !== curSeat &&
      !wasPhaseChange
    ) {
      const actorSeatIdx = prevCurrentSeat.current;
      const isMyOwnAction = actorSeatIdx === mySeat?.seatIndex;
      if (!isMyOwnAction) {
        const actorSeat = seats.find((s: any) => s.seatIndex === actorSeatIdx);
        if (actorSeat && actorSeat.status !== "folded") {
          const oldBet = prevSeatBets.current[actorSeatIdx] ?? 0;
          const newBet = actorSeat.currentBet ?? 0;
          let actionText = "";
          if (newBet > oldBet) {
            const wasRaise = newBet > prevTableBet.current;
            if (wasRaise) {
              actionText = `${actorSeat.playerName} raised to $${newBet.toLocaleString()}`;
              playSound("raise");
            } else {
              actionText = `${actorSeat.playerName} called $${(newBet - oldBet).toLocaleString()}`;
              playSound("chip");
            }
          } else {
            actionText = `${actorSeat.playerName} checked`;
            playSound("check");
          }
          if (actionText) setLog((l) => [...l, makeLog(actionText, "action")]);
        }
      }
    }

    // Your turn
    if (isMyTurn && gs.currentPlayerSeat !== prevCurrentSeat.current) {
      playSound("yourTurn");
      setShowYourTurn(true);
      if (yourTurnTimer.current) clearTimeout(yourTurnTimer.current);
      yourTurnTimer.current = setTimeout(() => setShowYourTurn(false), 2200);
    }

    // Update tracking refs
    prevCurrentSeat.current = gs.currentPlayerSeat ?? null;
    prevTableBet.current = gs.currentBet ?? 0;
    const newBetsMap: Record<number, number> = {};
    const newStatusMap: Record<number, string> = {};
    for (const s of seats) {
      newBetsMap[s.seatIndex] = s.currentBet ?? 0;
      newStatusMap[s.seatIndex] = s.status ?? "sitting";
    }
    prevSeatBets.current = newBetsMap;
    prevSeatStatuses.current = newStatusMap;
  }, [table?.gameState, table?.seats, isMyTurn]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  // ── Removal detection (bust / AFK kick / tournament elimination) ─────────
  useEffect(() => {
    if (!table) return;
    const mySeat = table.seats.find((s: any) => s.playerId === playerId);
    const isSeatedNow = !!mySeat;

    // Track our chip count while we are at the table
    if (isSeatedNow && mySeat.chips != null) {
      lastKnownChipsRef.current = mySeat.chips;
    }

    if (wasSeatedRef.current && !isSeatedNow) {
      // If the player voluntarily stood up or left, hasLeftRef is already true —
      // skip all removal logic (no AFK/elimination overlay, no forced redirect).
      if (hasLeftRef.current) {
        wasSeatedRef.current = isSeatedNow;
        return;
      }

      const wasBust = (lastKnownChipsRef.current ?? 1) <= 0;
      const isTournament = !!(table as any)?.tournamentId;
      const tournamentId = (table as any)?.tournamentId;

      if (wasBust && !isTournament) {
        // Cash game bust: show a brief banner and stay on the table so the
        // player can click any empty seat to sit back in with a fresh buy-in.
        setRemovalReason("bust");
        setTimeout(() => setRemovalReason(null), 5000);
        // Do NOT set hasLeftRef — they might rejoin, and leave-on-unmount
        // still needs to fire correctly for the new seat if they do.
      } else {
        // AFK kick or tournament elimination: boot them back to lobby / tournament.
        hasLeftRef.current = true;
        setRemovalReason(wasBust ? "eliminated" : "afk");
        setTimeout(() => {
          if (isTournament && tournamentId) {
            setLocation(`/tournament/${tournamentId}`);
          } else {
            setLocation("/lobby");
          }
        }, 3500);
      }
    }
    wasSeatedRef.current = isSeatedNow;
  }, [table?.seats, table?.status]);

  // ── Lone-player countdown (tournament only) ──────────────────────────────
  // When I'm the only active player left at a tournament table and no hand is
  // running, count down 30 s then bounce me to the tournament page to pick a table.
  useEffect(() => {
    if (!table || !isTournamentTable || !playerId || hasLeftRef.current) return;
    const tournamentId = (table as any).tournamentId;
    if (!tournamentId) return;

    const activePlayers = (table.seats as any[]).filter(
      (s) => s.playerId && (s.chips ?? 0) > 0
    );
    const iAmAlone =
      activePlayers.length === 1 &&
      activePlayers[0].playerId === playerId &&
      table.status !== "playing";

    if (iAmAlone) {
      // Start countdown if not already running
      if (aloneTimerRef.current === null) {
        setAloneCountdown(30);
        aloneTimerRef.current = setInterval(() => {
          setAloneCountdown((prev) => {
            if (prev === null || prev <= 1) {
              clearInterval(aloneTimerRef.current!);
              aloneTimerRef.current = null;
              hasLeftRef.current = true;
              setTimeout(() => setLocation(`/tournament/${tournamentId}`), 50);
              return null;
            }
            return prev - 1;
          });
        }, 1000);
      }
    } else {
      // Another player arrived or hand started — cancel countdown
      if (aloneTimerRef.current !== null) {
        clearInterval(aloneTimerRef.current);
        aloneTimerRef.current = null;
        setAloneCountdown(null);
      }
    }
  }, [table?.seats, table?.status, isTournamentTable, playerId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (aloneTimerRef.current !== null) {
        clearInterval(aloneTimerRef.current);
        aloneTimerRef.current = null;
      }
    };
  }, []);

  // ── Local blind countdown — ticks down from blindInfo.timeToNextLevel ───
  useEffect(() => {
    if (!blindInfo?.timeToNextLevel) { setLocalBlindCountdown(null); return; }
    setLocalBlindCountdown(blindInfo.timeToNextLevel);
    const id = setInterval(() => {
      setLocalBlindCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [blindInfo?.timeToNextLevel, blindInfo?.levelIndex]);

  useEffect(() => {
    if (!blindInfo) return;
    setBlindLevelFlash(true);
    const id = setTimeout(() => setBlindLevelFlash(false), 2000);
    return () => clearTimeout(id);
  }, [blindInfo?.levelIndex]);

  // ── Record LOCAL start time when it becomes my turn ─────────────────────
  // Uses client clock so server/browser clock skew never inflates the timer.
  useEffect(() => {
    if (isMyTurn) {
      setLocalTurnStartedAt(Date.now());
      autoFoldFiredRef.current = false;
      setRaiseAmount(String(bigBlind)); // pre-fill with min bet every time it's my turn
    } else {
      setLocalTurnStartedAt(null);
      setTurnTimerSec(null);
    }
  // Re-runs whenever the active seat changes (my turn OR another player's)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, table?.gameState?.currentPlayerSeat, table?.gameState?.phase]);

  // ── Countdown interval (runs off local client clock) ─────────────────────
  const TURN_LIMIT = 30; // seconds — hard cap, auto-fold at 0
  useEffect(() => {
    if (!isMyTurn || !localTurnStartedAt) return;
    const turnStart = localTurnStartedAt;

    const iv = setInterval(() => {
      const elapsed = (Date.now() - turnStart) / 1000;
      const remaining = Math.max(0, TURN_LIMIT - elapsed);
      setTurnTimerSec(Math.ceil(remaining));
      if (remaining <= 0 && !autoFoldFiredRef.current && !isActingRef.current) {
        autoFoldFiredRef.current = true;
        setTimeout(() => {
          if (!isActingRef.current) doAction("fold", undefined, true); // afk=true
        }, 50);
      }
    }, 100);

    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTurnStartedAt]);

  // ── action_ack: handle WS error responses from the server ─────────────────
  const { subscribe } = useWs();
  useEffect(() => {
    const unsub = subscribe("action_ack", (m: any) => {
      if (!m.success && m.error) setError(m.error);
      setIsActing(false);
    });
    return unsub;
  }, [subscribe]);

  // ── Actions ──────────────────────────────────────────────────────────────
  function doAction(action: string, amount?: number, afk = false) {
    if (!playerId || !sessionToken) return;
    setIsActing(true);
    setError(null);
    if (action === "fold") playSound("fold");
    else if (action === "check") playSound("check");
    else if (action === "call") playSound("chip");
    else if (action === "raise") playSound("raise");

    const actionLabel =
      action === "fold"
        ? "folded"
        : action === "check"
        ? "checked"
        : action === "call"
        ? `called $${callAmount}`
        : `raised to $${amount ?? raiseAmount}`;

    sendAction(sessionToken, action, amount, afk);
    setLog((l) => [...l, makeLog(`${mySeat?.playerName ?? "You"} ${actionLabel}`, "action")]);
    // isActing resets when action_ack arrives; safety timeout in case WS drops
    setTimeout(() => setIsActing(false), 3000);
  }

  async function handleStart() {
    playSound("deal");
    try {
      await startMutation.mutateAsync({ tableId });
    } catch (err: any) {
      setError(err?.message || "Could not start game");
    }
  }

  async function handleLeave() {
    if (!playerId) return;
    const tournamentId = (table as any)?.tournamentId;
    // Tournament tables: seats are permanent — just navigate back to the tournament page
    if (tournamentId) {
      setLocation(`/tournament/${tournamentId}`);
      return;
    }
    // If already removed from the table (e.g. AFK kick), just navigate away
    if (!mySeat) {
      setLocation("/lobby");
      return;
    }
    hasLeftRef.current = true;
    try {
      await leaveMutation.mutateAsync({ tableId, data: { playerId } });
      setLocation("/lobby");
    } catch (err: any) {
      hasLeftRef.current = false;
      setError(err?.message || "Could not leave table");
    }
  }

  async function handleStandUp() {
    if (!playerId) return;
    // Tournament seats are permanent — block stand-up
    if (isTournamentTable) return;
    hasLeftRef.current = true;
    try {
      await leaveMutation.mutateAsync({ tableId, data: { playerId } });
    } catch (err: any) {
      hasLeftRef.current = false;
      setError(err?.message || "Could not stand up");
    }
  }

  function handleSeatClick(seatIndex: number) {
    if (mySeat) return;
    playSound("buttonClick");
    setSelectedSeat(seatIndex);
    setBuyInAmount(String(table!.minBuyIn));
    setJoinPassword("");
    setJoinError(null);
  }

  async function handleConfirmJoin() {
    if (!playerId || selectedSeat === null) return;
    const amount = parseInt(buyInAmount);
    if (!amount || amount < table!.minBuyIn || amount > table!.maxBuyIn) {
      setJoinError(`Buy-in must be between ${table!.minBuyIn.toLocaleString()} and ${table!.maxBuyIn.toLocaleString()}`);
      return;
    }
    if ((table as any).hasPassword && !joinPassword.trim()) {
      setJoinError("This table requires a password");
      return;
    }
    playSound("chip");
    setIsJoining(true);
    setJoinError(null);
    try {
      await joinMutation.mutateAsync({
        tableId,
        data: {
          playerId,
          buyIn: amount,
          seatIndex: Number(selectedSeat),
          ...((table as any).hasPassword ? { password: joinPassword } : {}),
        },
      });
      hasLeftRef.current = false; // re-seated — re-arm removal detection
      setLog((l) => [...l, makeLog(`You joined the table`, "info")]);
      setSelectedSeat(null);
      setBuyInAmount("");
      setJoinPassword("");
    } catch (err: any) {
      setJoinError(err?.message || "Could not join seat");
    } finally {
      setIsJoining(false);
    }
  }

  if (!table) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-muted-foreground">Loading table…</div>
      </div>
    );
  }

  return (
    <div className="bg-transparent flex flex-col" style={{ height: "100vh", overflowX: "hidden" }}>
      {/* Action log — fixed right-side panel */}
      {(log.length > 0 || (table.gameState?.communityCards?.length ?? 0) > 0) && (
        <div className="fixed right-3 top-14 z-30 w-56 select-none">
          <div className="rounded-xl border border-white/8 bg-black/80 shadow-xl overflow-hidden">

            {/* Community cards strip */}
            {(table.gameState?.communityCards?.length ?? 0) > 0 && (
              <div className="px-3 pt-2.5 pb-2 border-b border-white/8 pointer-events-none">
                <div className="text-[9px] font-black uppercase tracking-widest text-white/30 mb-1.5">
                  {phaseLabels[table.gameState.phase] ?? "Board"}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {(table.gameState.communityCards as string[]).map((card, i) => (
                    <PlayingCard key={i} card={card} small />
                  ))}
                </div>
              </div>
            )}

            {/* Log entries — fixed height, newest at bottom, scrollable */}
            {log.length > 0 && (
              <div
                ref={logRef}
                className="overflow-y-auto px-3 py-2.5 space-y-0.5"
                style={{ maxHeight: "11rem", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
              >
                {log.slice(-50).map((e) => (
                  <div
                    key={e.id}
                    className={`text-[11px] leading-snug ${
                      e.type === "phase"  ? "text-yellow-300 font-semibold" :
                      e.type === "win"    ? "text-green-300 font-bold" :
                      e.type === "blind"  ? "text-blue-300" :
                      e.type === "action" ? "text-white/80" :
                      "text-white/45"
                    }`}
                  >
                    {e.type === "phase" && <span className="mr-1 opacity-50">··</span>}
                    {e.type === "blind" && (
                      <span className="mr-1 text-[9px] font-black uppercase tracking-widest opacity-60">
                        {e.text.startsWith("SB") ? "SB" : "BB"}
                      </span>
                    )}
                    {e.type === "blind" ? e.text.replace(/^(SB|BB)\s/, "") : e.text}
                  </div>
                ))}
                {table.gameState && !table.gameState.winner && table.gameState.currentPlayerSeat !== undefined && (
                  <div className="text-white/25 italic animate-pulse pt-0.5 text-[10px]">
                    {table.seats.find((s: any) => s.seatIndex === table.gameState.currentPlayerSeat)?.playerName ?? "..."} is thinking…
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-white/10 bg-black/60">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-display font-bold text-primary">{table.name}</h1>
            <span className="text-xs text-white/30">
              Blinds: {table.smallBlind}/{table.bigBlind}
            </span>
            {blindInfo && (
              <span
                className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-mono transition-all ${
                  blindLevelFlash
                    ? "bg-amber-900 border-amber-600 text-amber-300"
                    : "bg-white/5 border-white/10 text-white/40"
                }`}
                title={`Blind escalation — Level ${blindInfo.levelIndex + 1} of ${blindInfo.totalLevels}`}
              >
                <Timer className="w-2.5 h-2.5" />
                Lvl {blindInfo.levelIndex + 1}/{blindInfo.totalLevels}
                {localBlindCountdown !== null && (
                  <span className="ml-1">
                    {Math.floor(localBlindCountdown / 60)}:{String(localBlindCountdown % 60).padStart(2, "0")}
                  </span>
                )}
              </span>
            )}
            <AnimatePresence mode="wait">
              {phase && (
                <motion.span
                  key={phase}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${phaseColor[phase] ?? "bg-card border-border text-muted-foreground"}`}
                >
                  {phaseLabels[phase] ?? phase}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-3">
            <div
              title={wsConnected ? "Live — WebSocket connected" : "Reconnecting…"}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${wsConnected ? "border-green-700 text-green-400" : "border-yellow-700 text-yellow-400"}`}
            >
              {wsConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span>{wsConnected ? "Live" : "..."}</span>
            </div>
            {player && (
              <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-sm">
                <span className="text-white/50 text-xs">Wallet</span>
                <span className="font-bold text-amber-300">🪙 {(liveChips ?? player.chips ?? 0).toLocaleString()}</span>
              </div>
            )}
            {mySeat && (
              <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg px-3 py-1 text-sm">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-white/50 text-xs">Table</span>
                <span className="font-bold text-green-300">{(mySeat.chips ?? 0).toLocaleString()}</span>
              </div>
            )}
            <button
              onClick={handleLeave}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-colors px-2 py-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              {isTournamentTable ? "Back to Tournament" : "Leave"}
            </button>
          </div>
        </div>
      </div>

      {/* YOUR TURN flash banner */}
      <AnimatePresence>
        {showYourTurn && (
          <motion.div
            key="your-turn"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ repeat: Infinity, duration: 0.7 }}
              className="bg-primary text-black font-display font-black text-lg px-8 py-2.5 rounded-full shadow-gold-glow border-2 border-primary/50 tracking-widest uppercase"
            >
              Your Turn!
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cash-game bust banner — non-blocking, auto-hides after 5 s */}
      <AnimatePresence>
        {removalReason === "bust" && (
          <motion.div
            key="bust-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-black/90 border border-red-600 text-white px-5 py-3 rounded-xl shadow-xl"
          >
            <span className="text-2xl">💸</span>
            <div>
              <p className="font-bold text-red-400 text-sm">You're out of chips!</p>
              <p className="text-white/55 text-xs">Click any empty seat to buy back in.</p>
            </div>
            <button
              onClick={() => setRemovalReason(null)}
              className="ml-2 text-white/30 hover:text-white/70 text-lg leading-none cursor-pointer"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen overlay for AFK kick or tournament elimination */}
      <AnimatePresence>
        {(removalReason === "afk" || removalReason === "eliminated") && (
          <motion.div
            key="removal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="text-center"
            >
              {removalReason === "eliminated" ? (
                <>
                  <div className="text-5xl mb-4">💀</div>
                  <h2 className="text-2xl font-display font-black text-white mb-2 tracking-wide">Eliminated!</h2>
                  <p className="text-white/50 text-sm">You ran out of chips. Better luck next time.</p>
                </>
              ) : (
                <>
                  <div className="text-5xl mb-4">💤</div>
                  <h2 className="text-2xl font-display font-black text-white mb-2 tracking-wide">You Were Removed</h2>
                  <p className="text-white/50 text-sm">Too many AFK folds. Your chips have been returned.</p>
                </>
              )}
              <p className="text-white/30 text-xs mt-3 animate-pulse">Returning to lobby…</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alone-at-table countdown overlay (tournament only) */}
      <AnimatePresence>
        {aloneCountdown !== null && (
          <motion.div
            key="alone-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="text-center bg-card border border-border rounded-2xl p-8 max-w-xs w-full shadow-2xl"
            >
              <div className="text-4xl mb-3">🪑</div>
              <h2 className="text-xl font-display font-black text-white mb-1">Table's Empty</h2>
              <p className="text-white/50 text-sm mb-5">You're the only one left. Pick a new table or you'll be moved automatically.</p>
              <div className="relative flex items-center justify-center mb-5">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15.9" fill="none"
                    stroke="hsl(var(--primary))" strokeWidth="3"
                    strokeDasharray={`${(aloneCountdown / 30) * 100} 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-2xl font-mono font-black text-primary leading-none">{aloneCountdown}</span>
                  <span className="text-[10px] text-white/40 uppercase tracking-wide">sec</span>
                </div>
              </div>
              <Button
                onClick={() => {
                  if (aloneTimerRef.current !== null) {
                    clearInterval(aloneTimerRef.current);
                    aloneTimerRef.current = null;
                  }
                  setAloneCountdown(null);
                  hasLeftRef.current = true;
                  const tournamentId = (table as any)?.tournamentId;
                  if (tournamentId) setLocation(`/tournament/${tournamentId}`);
                }}
                className="w-full"
              >
                <Timer className="w-4 h-4 mr-2" />
                Choose a Table Now
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main area */}
      <div className="flex-1 flex flex-col w-full px-3 py-1 gap-2 justify-center min-h-0">
        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-destructive/20 border border-destructive/40 rounded-xl px-4 py-2 text-destructive-foreground text-sm"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Poker Table */}
        <div className="w-full px-2" style={{ zoom: 0.88 }}>
          <PokerTableVisual
            table={table as any}
            myPlayerId={playerId}
            onSeatClick={!mySeat ? handleSeatClick : undefined}
            onStandUp={mySeat && !isTournamentTable ? handleStandUp : undefined}
            peeking={peeking}
            actionProps={mySeat ? {
              isMyTurn,
              pot,
              callAmount,
              raiseAmount,
              setRaiseAmount,
              doAction,
              bigBlind,
              myChips,
              visibleChips,
              raisePresets,
              isActing,
              peeking,
              setPeeking,
              playSound,
              turnTimerSec,
              myCards,
              TURN_LIMIT: 30,
            } satisfies SeatActionProps : undefined}
          />
        </div>



        {/* Start / Deal New Hand */}
        {(canStart || canStartNewHand) && (
          <div className="flex justify-center">
            <Button size="lg" onClick={handleStart} isLoading={startMutation.isPending}>
              <Play className="w-5 h-5 mr-2" />
              {canStartNewHand ? "Deal New Hand" : "Start Game"}
            </Button>
          </div>
        )}

      </div>

      {/* ── Status strip — waiting / tournament / sitting out ── */}
      {mySeat && table.status !== "playing" && (
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(6,2,4,0.85)",
          padding: "5px 14px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          {table.status === "waiting" && table.seats.filter((s: any) => s.playerId).length < 2 && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Waiting for players… ({table.seats.filter((s: any) => s.playerId).length}/2 minimum)
            </span>
          )}
          {table.status === "waiting" && table.seats.filter((s: any) => s.playerId).length >= 2 && !isTournamentTable && (
            <span className="animate-pulse" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Starting shortly…</span>
          )}
          {table.status === "finished" && (
            <span className="animate-pulse" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Next hand dealing…</span>
          )}
          {mySeat?.status === "sitting_out" && (
            <span className="animate-pulse" style={{ fontSize: 11, color: "rgba(251,191,36,0.7)" }}>Sitting out — dealt in next hand</span>
          )}
          {table.status === "waiting" && isTournamentTable && seatedPlayerIds.length >= 2 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 3 }}>
                {seatedPlayerIds.map((id: any) => (
                  <span key={id} style={{ width: 8, height: 8, borderRadius: "50%", background: readyPlayerIds.includes(id) ? "#4ade80" : "rgba(255,255,255,0.18)", display: "inline-block" }} />
                ))}
              </div>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{validReadyCount}/{readyThreshold} ready</span>
              <button onClick={handleReadyUp} disabled={isReadying}
                style={{
                  padding: "3px 10px", borderRadius: 5, fontSize: 9, fontWeight: 700, cursor: "pointer",
                  background: iAmReady ? "rgba(34,197,94,0.15)" : "#22c55e",
                  color: iAmReady ? "#4ade80" : "#000",
                  border: iAmReady ? "1px solid rgba(74,222,128,0.4)" : "none",
                  fontFamily: "'Oswald', sans-serif",
                }}>
                {isReadying ? "…" : iAmReady ? "✓ Ready" : "Ready Up"}
              </button>
            </div>
          )}
        </div>
      )}

            {/* Seat Buy-In Modal */}
      <AnimatePresence>
        {selectedSeat !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedSeat(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-lg font-display font-bold text-foreground">Take Seat {selectedSeat + 1}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Buy-in: {table.minBuyIn.toLocaleString()} – {table.maxBuyIn.toLocaleString()} chips
                  </p>
                </div>
                <button
                  onClick={() => setSelectedSeat(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">
                    Buy-In Amount
                  </label>
                  <Input
                    type="number"
                    placeholder={`${table.minBuyIn} – ${table.maxBuyIn}`}
                    value={buyInAmount}
                    onChange={(e) => setBuyInAmount(e.target.value)}
                    min={table.minBuyIn}
                    max={table.maxBuyIn}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleConfirmJoin(); }}
                  />
                </div>
                {(table as any).hasPassword && (
                  <div>
                    <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">
                      Table Password
                    </label>
                    <Input
                      type="password"
                      placeholder="Enter table password"
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleConfirmJoin(); }}
                      autoComplete="off"
                    />
                  </div>
                )}
                {joinError && <p className="text-destructive text-sm">{joinError}</p>}
                <div className="flex gap-3 pt-1">
                  <Button variant="ghost" className="flex-1" onClick={() => setSelectedSeat(null)} disabled={isJoining}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={handleConfirmJoin} isLoading={isJoining} disabled={!buyInAmount}>
                    Sit Down
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spectator hint — fixed so it's never hidden by seats */}
      {!mySeat && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/70 border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-white/50 font-medium tracking-wide">Click a seat on the table to sit down</span>
          </div>
        </div>
      )}
      <PromoZone pageKey="poker" />
    </div>
  );
}
