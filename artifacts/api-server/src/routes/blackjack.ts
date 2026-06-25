import { Router } from "express";
import { db, blackjackGamesTable, blackjackHandsTable, blackjackTablesTable, playersTable, settingsTable, transactionsTable } from "@workspace/db";
import { eq, and, desc, ilike, sql } from "drizzle-orm";
import { recordPlayerActivity } from "../lib/player-activity.js";
import {
  createDeck,
  dealInitialHand,
  dealerPlay,
  handValue,
  isBust,
  biasedDraw,
  determineWinner,
  calculatePayout,
  type Card,
  type GameStatus,
} from "../lib/blackjack-engine.js";
import { requirePlayer, requireDealerOrAbove } from "../middleware/auth.js";
import { isPlayerGameBanned } from "./security.js";
import { broadcastPlayerBalance, broadcastPlayerBalanceDelayed } from "../lib/table-ws.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";
import { getAllBJRooms, getBJRoom, createBJRoom, deleteBJRoom, type BJTableConfig } from "../lib/blackjack-room.js";
import bcrypt from "bcryptjs";

const router = Router();

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

async function setSetting(key: string, value: string) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) {
    await db.insert(settingsTable).values({ key, value });
  } else {
    await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
  }
}

function applyHouseEdge(bet: number, rawPayout: number, houseEdgePct: number): { finalPayout: number; rake: number } {
  if (rawPayout <= bet || houseEdgePct <= 0) return { finalPayout: rawPayout, rake: 0 };
  const profit = rawPayout - bet;
  const rake = Math.floor(profit * houseEdgePct / 100);
  return { finalPayout: rawPayout - rake, rake };
}

async function recordRake(rake: number) {
  if (rake <= 0) return;
  const current = parseInt(await getSetting("totalRakeCollected", "0"));
  await setSetting("totalRakeCollected", String(current + rake));
}

function gameResponse(game: any, playerCards: Card[], splitCards: Card[] | null, dealerCards: Card[], activeHand: string) {
  return {
    ...game,
    playerValue: handValue(playerCards),
    splitValue: splitCards ? handValue(splitCards) : undefined,
    dealerValue: handValue([dealerCards[0]]),
    activeHand,
  };
}

async function resolveAndPayout(
  gameId: number,
  playerId: number,
  finalPlayerCards: Card[],
  finalSplitCards: Card[] | null,
  finalDealerCards: Card[],
  mainBet: number,
  splitBetAmt: number | null,
) {
  const houseEdgePct = parseFloat(await getSetting("blackjackHouseEdge", "0"));

  const mainResult = determineWinner(finalPlayerCards, finalDealerCards);
  const mainRaw = calculatePayout(mainBet, mainResult);
  const { finalPayout: mainPayout, rake: mainRake } = applyHouseEdge(mainBet, mainRaw, houseEdgePct);

  let splitResult: GameStatus | null = null;
  let splitPayoutAmt = 0;
  let splitRake = 0;

  if (finalSplitCards && splitBetAmt) {
    splitResult = determineWinner(finalSplitCards, finalDealerCards);
    const splitRaw = calculatePayout(splitBetAmt, splitResult);
    const applied = applyHouseEdge(splitBetAmt, splitRaw, houseEdgePct);
    splitPayoutAmt = applied.finalPayout;
    splitRake = applied.rake;
  }

  const totalPayout = mainPayout + splitPayoutAmt;
  const totalRake = mainRake + splitRake;
  const totalBet = mainBet + (splitBetAmt ?? 0);

  await trackRakebackBet(playerId, totalBet).catch(() => {});
  if (totalPayout > 0) await trackRakebackWin(playerId, totalPayout, 1).catch(() => {});

  if (totalPayout > 0) {
    const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    await db.update(playersTable).set({ chips: fresh.chips + totalPayout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({
      playerId,
      amount: totalPayout,
      type: "win",
      description: `Blackjack payout (${mainResult}${splitResult ? `, split: ${splitResult}` : ""})`,
    });
    await recordRake(totalRake);
  }

  const totalHands = parseInt(await getSetting("totalHandsPlayed", "0"));
  await setSetting("totalHandsPlayed", String(totalHands + 1));

  const [updated] = await db.update(blackjackGamesTable).set({
    playerCards: finalPlayerCards as any,
    splitCards: finalSplitCards as any,
    dealerCards: finalDealerCards as any,
    status: mainResult,
    splitStatus: splitResult ?? undefined,
    payout: mainPayout,
    splitPayout: splitPayoutAmt || undefined,
    updatedAt: new Date(),
  }).where(eq(blackjackGamesTable.id, gameId)).returning();

  return { updated, finalDealerCards, mainResult, splitResult };
}

// GET /blackjack/status
router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("blackjackEnabled", "true")) === "true";
  const houseEdge = parseFloat(await getSetting("blackjackHouseEdge", "2.5"));
  const passwordHash = await getSetting("blackjackPassword", "");

  // Compute bet range from all currently-open tables
  const openRooms = getAllBJRooms().filter(r => r.isOpen);
  const minBet = openRooms.length > 0 ? Math.min(...openRooms.map(r => r.minBet)) : parseInt(await getSetting("blackjackMinBet", "100"));
  const maxBet = openRooms.length > 0 ? Math.max(...openRooms.map(r => r.maxBet)) : parseInt(await getSetting("blackjackMaxBet", "10000"));
  const openTableCount = openRooms.length;

  return res.json({ enabled: enabled && openRooms.length > 0, minBet, maxBet, houseEdge, hasPassword: !!passwordHash, openTableCount });
});

// POST /blackjack/tables/:id/verify-password — check per-table password
router.post("/tables/:id/verify-password", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const room = getBJRoom(id);
    if (!room) return res.status(404).json({ error: "Table not found" });
    if (!room.passwordHash) return res.json({ valid: true }); // no password on this table
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    const valid = await bcrypt.compare(String(password), room.passwordHash);
    if (!valid) return res.status(403).json({ error: "Incorrect table password" });
    return res.json({ valid: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

// POST /blackjack/verify-password
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("blackjackPassword", "");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room password" });
  const token = await getSetting("blackjackPasswordToken", "");
  return res.json({ valid: true, token: token || null });
});

// POST /blackjack/deal
router.post("/deal", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const banCheck = await isPlayerGameBanned(playerId, "blackjack");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Blackjack${banCheck.reason ? ": " + banCheck.reason : ""}` });
  const { bet } = req.body;
  if (!bet) return res.status(400).json({ error: "bet is required" });

  const enabled = (await getSetting("blackjackEnabled", "true")) === "true";
  if (!enabled) return res.status(403).json({ error: "Blackjack table is currently closed" });

  const minBet = parseInt(await getSetting("blackjackMinBet", "100"));
  const maxBet = parseInt(await getSetting("blackjackMaxBet", "10000"));
  if (bet < minBet || bet > maxBet) {
    return res.status(400).json({ error: `Bet must be between ${minBet} and ${maxBet} chips` });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });
  recordPlayerActivity(playerId, player.username, "blackjack", true);

  // Refund any orphaned active hand before starting a new one.
  // This prevents chip loss when a player closes their tablet mid-hand and
  // then deals again on re-open without finishing the previous hand.
  const [orphan] = await db
    .select()
    .from(blackjackGamesTable)
    .where(and(eq(blackjackGamesTable.playerId, playerId), eq(blackjackGamesTable.status, "active")));
  if (orphan) {
    await db.update(blackjackGamesTable)
      .set({ status: "abandoned" })
      .where(eq(blackjackGamesTable.id, orphan.id));
    // Refund the original bet so the player doesn't lose chips for a hand they never finished
    await db.update(playersTable).set({ chips: player.chips + orphan.bet }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: orphan.bet, type: "win", description: "Blackjack hand refund (disconnected)" });
    // Re-read player chips after refund so the new deduction is correct
    const [refreshed] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    player.chips = refreshed.chips;
  }

  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Blackjack bet" });
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  const deck = createDeck(6);
  const { playerCards, dealerCards } = dealInitialHand(deck);

  let status: string = "active";

  if (handValue(playerCards) === 21) {
    const fullDealerCards = dealerCards.map(c => ({ ...c, hidden: false }));
    const houseEdgePct = parseFloat(await getSetting("blackjackHouseEdge", "0"));
    const result = determineWinner(playerCards, fullDealerCards);
    const rawPayout = calculatePayout(bet, result);
    const { finalPayout: payout, rake } = applyHouseEdge(bet, rawPayout, houseEdgePct);
    status = result;

    if (payout > 0) {
      await db.update(playersTable).set({ chips: player.chips - bet + payout }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Blackjack payout (${result})` });
      await recordRake(rake);
    }

    const [game] = await db.insert(blackjackGamesTable).values({
      playerId, status, playerCards: playerCards as any, dealerCards: fullDealerCards as any, bet, payout, activeHand: "main",
    }).returning();

    const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, Number(updatedPlayer.chips));
    return res.json({
      game: { ...game, playerValue: handValue(playerCards), dealerValue: handValue(fullDealerCards), activeHand: "main" },
      player: updatedPlayer,
    });
  }

  const [game] = await db.insert(blackjackGamesTable).values({
    playerId, status, playerCards: playerCards as any, dealerCards: dealerCards as any, bet, activeHand: "main",
  }).returning();

  const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalance(playerId, Number(updatedPlayer.chips));
  return res.json({
    game: { ...game, playerValue: handValue(playerCards), dealerValue: handValue([dealerCards[0]]), activeHand: "main" },
    player: updatedPlayer,
  });
});

// POST /blackjack/:gameId/hit
router.post("/:gameId/hit", requirePlayer, async (req, res) => {
  const gameId = parseInt(req.params.gameId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [game] = await db.select().from(blackjackGamesTable).where(eq(blackjackGamesTable.id, gameId));
  if (!game) return res.status(404).json({ error: "Game not found" });
  if (game.playerId !== playerId) return res.status(403).json({ error: "Not your game" });
  if (game.status !== "active") return res.status(400).json({ error: "Game is not active" });

  const deck = createDeck(6);
  const activeHand = (game.activeHand ?? "main") as string;
  const oddsMode = await getSetting("blackjackOddsMode", "standard");

  if (activeHand === "split") {
    const splitCards = [...(game.splitCards as Card[]), biasedDraw(deck, oddsMode, handValue(game.splitCards as Card[]), true)];
    const splitBustValue = handValue(splitCards);

    if (isBust(splitCards)) {
      // Dealer must play to completion before resolving — pass through dealerPlay
      // so the hidden card is revealed and the dealer draws to 17+
      const { dealerCards: playedDealerCards } = dealerPlay(game.dealerCards as Card[], deck, oddsMode);
      const { updated, finalDealerCards, mainResult, splitResult } = await resolveAndPayout(
        gameId, playerId,
        game.playerCards as Card[], splitCards,
        playedDealerCards,
        game.bet, game.splitBet ?? game.bet,
      );
      const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      broadcastPlayerBalanceDelayed(playerId, Number(updatedPlayer.chips), 1500);
      return res.json({
        game: {
          ...updated,
          splitCards: splitCards,
          dealerCards: finalDealerCards,
          playerValue: handValue(game.playerCards as Card[]),
          splitValue: splitBustValue,
          dealerValue: handValue(finalDealerCards),
          activeHand: "split",
        },
        player: updatedPlayer,
      });
    }

    const [updated] = await db.update(blackjackGamesTable)
      .set({ splitCards: splitCards as any, updatedAt: new Date() })
      .where(eq(blackjackGamesTable.id, gameId)).returning();

    return res.json({
      game: {
        ...updated,
        playerValue: handValue(game.playerCards as Card[]),
        splitValue: handValue(splitCards),
        dealerValue: handValue([(game.dealerCards as Card[])[0]]),
        activeHand: "split",
      },
    });
  }

  // Main hand hit
  const playerCards = [...(game.playerCards as Card[]), biasedDraw(deck, oddsMode, handValue(game.playerCards as Card[]), true)];

  if (isBust(playerCards)) {
    if (game.splitCards) {
      // Main hand busted — switch to split hand instead of resolving
      const [updated] = await db.update(blackjackGamesTable)
        .set({ playerCards: playerCards as any, activeHand: "split", updatedAt: new Date() })
        .where(eq(blackjackGamesTable.id, gameId)).returning();
      return res.json({
        game: {
          ...updated,
          playerValue: handValue(playerCards),
          splitValue: handValue(game.splitCards as Card[]),
          dealerValue: handValue([(game.dealerCards as Card[])[0]]),
          activeHand: "split",
        },
      });
    }

    // Regular bust — no split
    const dealerCards = game.dealerCards as Card[];
    const visibleDealer = dealerCards.map(c => ({ ...c, hidden: false }));
    await db.update(blackjackGamesTable)
      .set({ playerCards: playerCards as any, dealerCards: visibleDealer as any, status: "player_bust", payout: 0, updatedAt: new Date() })
      .where(eq(blackjackGamesTable.id, gameId));
    const [updated] = await db.select().from(blackjackGamesTable).where(eq(blackjackGamesTable.id, gameId));
    return res.json({
      game: {
        ...updated,
        dealerCards: visibleDealer,
        playerValue: handValue(playerCards),
        dealerValue: handValue([visibleDealer[0]]),
        activeHand: "main",
      },
    });
  }

  const [updated] = await db.update(blackjackGamesTable)
    .set({ playerCards: playerCards as any, updatedAt: new Date() })
    .where(eq(blackjackGamesTable.id, gameId)).returning();

  return res.json({
    game: {
      ...updated,
      playerValue: handValue(playerCards),
      dealerValue: handValue([(game.dealerCards as Card[])[0]]),
      activeHand: "main",
    },
  });
});

// POST /blackjack/:gameId/stand
router.post("/:gameId/stand", requirePlayer, async (req, res) => {
  const gameId = parseInt(req.params.gameId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [game] = await db.select().from(blackjackGamesTable).where(eq(blackjackGamesTable.id, gameId));
  if (!game) return res.status(404).json({ error: "Game not found" });
  if (game.playerId !== playerId) return res.status(403).json({ error: "Not your game" });
  if (game.status !== "active") return res.status(400).json({ error: "Game is not active" });

  const activeHand = (game.activeHand ?? "main") as string;

  // Standing on main hand while split exists → switch to split hand
  if (activeHand === "main" && game.splitCards) {
    const [updated] = await db.update(blackjackGamesTable)
      .set({ activeHand: "split", updatedAt: new Date() })
      .where(eq(blackjackGamesTable.id, gameId)).returning();
    return res.json({
      game: {
        ...updated,
        playerValue: handValue(game.playerCards as Card[]),
        splitValue: handValue(game.splitCards as Card[]),
        dealerValue: handValue([(game.dealerCards as Card[])[0]]),
        activeHand: "split",
      },
    });
  }

  // Otherwise resolve: dealer plays, both hands evaluated
  const deck = createDeck(6);
  const standOddsMode = await getSetting("blackjackOddsMode", "standard");
  const finalPlayerCards = game.playerCards as Card[];
  const finalSplitCards = game.splitCards ? (game.splitCards as Card[]) : null;
  const { dealerCards: finalDealerCards } = dealerPlay(game.dealerCards as Card[], deck, standOddsMode);

  const { updated, finalDealerCards: fd, mainResult, splitResult } = await resolveAndPayout(
    gameId, playerId,
    finalPlayerCards, finalSplitCards,
    finalDealerCards,
    game.bet, game.splitBet ?? (finalSplitCards ? game.bet : null),
  );

  const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalanceDelayed(playerId, Number(updatedPlayer.chips), 1500);

  return res.json({
    game: {
      ...updated,
      dealerCards: fd,
      playerValue: handValue(finalPlayerCards),
      splitValue: finalSplitCards ? handValue(finalSplitCards) : undefined,
      dealerValue: handValue(fd),
      activeHand,
    },
    player: updatedPlayer,
  });
});

// POST /blackjack/:gameId/double
router.post("/:gameId/double", requirePlayer, async (req, res) => {
  const gameId = parseInt(req.params.gameId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [game] = await db.select().from(blackjackGamesTable).where(eq(blackjackGamesTable.id, gameId));
  if (!game) return res.status(404).json({ error: "Game not found" });
  if (game.playerId !== playerId) return res.status(403).json({ error: "Not your game" });
  if (game.status !== "active") return res.status(400).json({ error: "Game is not active" });

  const activeHand = (game.activeHand ?? "main") as string;

  const deck = createDeck(6);
  const doubleOddsMode = await getSetting("blackjackOddsMode", "standard");
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));

  if (activeHand === "split") {
    const splitCards = game.splitCards as Card[];
    if (splitCards.length !== 2) return res.status(400).json({ error: "Can only double on first two cards of split hand" });
    const splitBetAmt = game.splitBet ?? game.bet;
    if (player.chips < splitBetAmt) return res.status(400).json({ error: "Insufficient chips to double split hand" });

    await db.update(playersTable).set({ chips: player.chips - splitBetAmt }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: splitBetAmt, type: "loss", description: "Blackjack double (split hand)" });

    const newSplitCards = [...splitCards, biasedDraw(deck, doubleOddsMode, handValue(splitCards), true)];
    const newSplitBet = splitBetAmt * 2;
    await db.update(blackjackGamesTable).set({ splitBet: newSplitBet }).where(eq(blackjackGamesTable.id, gameId));

    const { dealerCards: finalDealerCards } = dealerPlay(game.dealerCards as Card[], deck, doubleOddsMode);
    const { updated, finalDealerCards: fd } = await resolveAndPayout(
      gameId, playerId,
      game.playerCards as Card[], newSplitCards,
      finalDealerCards,
      game.bet, newSplitBet,
    );

    const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalanceDelayed(playerId, Number(updatedPlayer.chips), 1500);
    return res.json({
      game: {
        ...updated,
        splitCards: newSplitCards,
        dealerCards: fd,
        playerValue: handValue(game.playerCards as Card[]),
        splitValue: handValue(newSplitCards),
        dealerValue: handValue(fd),
        activeHand: "split",
      },
      player: updatedPlayer,
    });
  }

  // Main hand double
  if ((game.playerCards as Card[]).length !== 2) return res.status(400).json({ error: "Can only double on first two cards" });
  if (player.chips < game.bet) return res.status(400).json({ error: "Insufficient chips to double down" });

  await db.update(playersTable).set({ chips: player.chips - game.bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: game.bet, type: "loss", description: "Blackjack double down bet" });

  const playerCards = [...(game.playerCards as Card[]), biasedDraw(deck, doubleOddsMode, handValue(game.playerCards as Card[]), true)];
  const newMainBet = game.bet * 2;

  if (isBust(playerCards)) {
    if (game.splitCards) {
      // Main hand busted after double — switch to split hand
      const [updated] = await db.update(blackjackGamesTable)
        .set({ playerCards: playerCards as any, bet: newMainBet, activeHand: "split", updatedAt: new Date() })
        .where(eq(blackjackGamesTable.id, gameId)).returning();
      const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      broadcastPlayerBalance(playerId, Number(updatedPlayer.chips));
      return res.json({
        game: {
          ...updated,
          playerValue: handValue(playerCards),
          splitValue: handValue(game.splitCards as Card[]),
          dealerValue: handValue([(game.dealerCards as Card[])[0]]),
          activeHand: "split",
        },
        player: updatedPlayer,
      });
    }

    // Regular bust on double
    const visibleDealer = (game.dealerCards as Card[]).map(c => ({ ...c, hidden: false }));
    const [updated] = await db.update(blackjackGamesTable)
      .set({ playerCards: playerCards as any, dealerCards: visibleDealer as any, status: "player_bust", bet: newMainBet, payout: 0, updatedAt: new Date() })
      .where(eq(blackjackGamesTable.id, gameId)).returning();
    const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, Number(updatedPlayer.chips));
    return res.json({
      game: { ...updated, dealerCards: visibleDealer, playerValue: handValue(playerCards), dealerValue: handValue(visibleDealer), activeHand: "main" },
      player: updatedPlayer,
    });
  }

  // Main hand didn't bust after double
  if (game.splitCards) {
    // Switch to split hand (don't run dealer yet)
    const [updated] = await db.update(blackjackGamesTable)
      .set({ playerCards: playerCards as any, bet: newMainBet, activeHand: "split", updatedAt: new Date() })
      .where(eq(blackjackGamesTable.id, gameId)).returning();
    const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, Number(updatedPlayer.chips));
    return res.json({
      game: {
        ...updated,
        playerValue: handValue(playerCards),
        splitValue: handValue(game.splitCards as Card[]),
        dealerValue: handValue([(game.dealerCards as Card[])[0]]),
        activeHand: "split",
      },
      player: updatedPlayer,
    });
  }

  // Regular double — resolve immediately
  const { dealerCards: finalDealerCards } = dealerPlay(game.dealerCards as Card[], deck, doubleOddsMode);
  const { updated, finalDealerCards: fd } = await resolveAndPayout(
    gameId, playerId, playerCards, null, finalDealerCards, newMainBet, null,
  );
  const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalanceDelayed(playerId, Number(updatedPlayer.chips), 1500);
  return res.json({
    game: { ...updated, dealerCards: fd, playerValue: handValue(playerCards), dealerValue: handValue(fd), activeHand: "main" },
    player: updatedPlayer,
  });
});

// POST /blackjack/:gameId/split
router.post("/:gameId/split", requirePlayer, async (req, res) => {
  const gameId = parseInt(req.params.gameId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [game] = await db.select().from(blackjackGamesTable).where(eq(blackjackGamesTable.id, gameId));
  if (!game) return res.status(404).json({ error: "Game not found" });
  if (game.playerId !== playerId) return res.status(403).json({ error: "Not your game" });
  if (game.status !== "active") return res.status(400).json({ error: "Game is not active" });
  if ((game.activeHand ?? "main") !== "main") return res.status(400).json({ error: "Can only split on main hand" });

  const playerCards = game.playerCards as Card[];
  if (playerCards.length !== 2) return res.status(400).json({ error: "Can only split on first two cards" });
  if (playerCards[0].rank !== playerCards[1].rank) return res.status(400).json({ error: "Can only split matching pairs" });
  if (game.splitCards) return res.status(400).json({ error: "Already split" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (player.chips < game.bet) return res.status(400).json({ error: "Insufficient chips to split" });

  await db.update(playersTable).set({ chips: player.chips - game.bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: game.bet, type: "loss", description: "Blackjack split bet" });

  const deck = createDeck(6);
  const hand1: Card[] = [playerCards[0], deck.pop()!];
  const hand2: Card[] = [playerCards[1], deck.pop()!];

  const [updated] = await db.update(blackjackGamesTable).set({
    playerCards: hand1 as any,
    splitCards: hand2 as any,
    splitBet: game.bet,
    activeHand: "main",
    updatedAt: new Date(),
  }).where(eq(blackjackGamesTable.id, gameId)).returning();

  const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalance(playerId, Number(updatedPlayer.chips));

  return res.json({
    game: {
      ...updated,
      playerValue: handValue(hand1),
      splitValue: handValue(hand2),
      dealerValue: handValue([(game.dealerCards as Card[])[0]]),
      activeHand: "main",
    },
    player: updatedPlayer,
  });
});

// ── Table management (dealer+) ────────────────────────────────────────────────

// GET /api/blackjack/tables — public list with live state
router.get("/tables", async (_req, res) => {
  try {
    const tables = await db.select().from(blackjackTablesTable);
    const rooms = getAllBJRooms();
    const roomMap = new Map(rooms.map(r => [r.tableId, r]));
    const result = tables.map(t => {
      const room = roomMap.get(t.id);
      return {
        id: t.id,
        name: t.name,
        minBet: t.minBet,
        maxBet: t.maxBet,
        numSeats: t.numSeats,
        theme: t.theme,
        isOpen: t.isOpen,
        hasPassword: !!t.passwordHash,
        houseEdge: t.houseEdge ?? 2.5,
        createdAt: t.createdAt,
        seatedCount: room?.getSeatedCount() ?? 0,
        phase: room?.getPhase() ?? "WAITING",
      };
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

// POST /api/blackjack/tables — create table
router.post("/tables", requireDealerOrAbove, async (req, res) => {
  try {
    const { name, minBet, maxBet, numSeats = 6, theme = "velvet", password, houseEdge } = req.body;
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required" });
    if (!minBet || !maxBet) return res.status(400).json({ error: "minBet and maxBet are required" });
    const validThemes = ["velvet", "gold", "diamond"];
    const safeTheme = validThemes.includes(theme) ? theme : "velvet";
    const safeSeats = Math.min(7, Math.max(1, parseInt(numSeats) || 6));
    const safeEdge = Math.max(0, Math.min(50, parseFloat(houseEdge) || 2.5));

    let passwordHash: string | null = null;
    if (password && typeof password === "string" && password.trim()) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    const [row] = await db.insert(blackjackTablesTable).values({
      name: name.trim(),
      minBet: parseInt(minBet),
      maxBet: parseInt(maxBet),
      numSeats: safeSeats,
      theme: safeTheme,
      houseEdge: safeEdge,
      passwordHash,
      isOpen: true,
    }).returning();

    const cfg: BJTableConfig = {
      id: row.id,
      name: row.name,
      minBet: row.minBet,
      maxBet: row.maxBet,
      numSeats: row.numSeats,
      theme: row.theme,
      isOpen: row.isOpen,
      passwordHash: row.passwordHash,
      houseEdge: row.houseEdge ?? 2.5,
    };
    await createBJRoom(cfg);
    console.log(`[BJ] Table created: id=${row.id} name="${row.name}"`);
    res.status(201).json({ ...row, seatedCount: 0, phase: "WAITING", hasPassword: !!row.passwordHash });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

// DELETE /api/blackjack/tables/:id — delete table
router.delete("/tables/:id", requireDealerOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    await db.delete(blackjackTablesTable).where(eq(blackjackTablesTable.id, id));
    deleteBJRoom(id);
    console.log(`[BJ] Table deleted: id=${id}`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

// POST /api/blackjack/tables/:id/toggle — toggle open/closed
router.post("/tables/:id/toggle", requireDealerOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const [row] = await db.select().from(blackjackTablesTable).where(eq(blackjackTablesTable.id, id));
    if (!row) return res.status(404).json({ error: "Table not found" });
    const newOpen = !row.isOpen;
    await db.update(blackjackTablesTable).set({ isOpen: newOpen }).where(eq(blackjackTablesTable.id, id));
    const room = getBJRoom(id);
    if (room) room.isOpen = newOpen;
    res.json({ id, isOpen: newOpen });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

// PATCH /api/blackjack/tables/:id — update name, minBet, maxBet, houseEdge, password
router.patch("/tables/:id", requireDealerOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { name, minBet, maxBet, theme, password, clearPassword, houseEdge } = req.body;
    const updates: Partial<typeof blackjackTablesTable.$inferInsert> = {};
    if (name && typeof name === "string") updates.name = name.trim();
    if (minBet) updates.minBet = parseInt(minBet);
    if (maxBet) updates.maxBet = parseInt(maxBet);
    if (houseEdge !== undefined) updates.houseEdge = Math.max(0, Math.min(50, parseFloat(houseEdge) || 0));
    const validThemes = ["velvet", "gold", "diamond"];
    if (theme && validThemes.includes(theme)) updates.theme = theme;
    if (clearPassword) {
      updates.passwordHash = null;
    } else if (password && typeof password === "string" && password.trim()) {
      updates.passwordHash = await bcrypt.hash(password.trim(), 10);
    }
    const [row] = await db.update(blackjackTablesTable).set(updates).where(eq(blackjackTablesTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Table not found" });
    const room = getBJRoom(id);
    if (room) {
      if (updates.name) room.name = updates.name;
      if (updates.minBet) room.minBet = updates.minBet;
      if (updates.maxBet) room.maxBet = updates.maxBet;
      if (updates.theme) room.theme = updates.theme;
      if (updates.houseEdge !== undefined) room.houseEdge = updates.houseEdge;
      if (updates.passwordHash !== undefined) room.passwordHash = updates.passwordHash;
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

// ── GET /blackjack/hands — hand history for the banker dashboard ──────────────
router.get("/hands", requireDealerOrAbove, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  ?? "100")), 500);
    const offset = parseInt(String(req.query.offset ?? "0"));
    const player = String(req.query.player ?? "").trim();
    const result = String(req.query.result ?? "").trim();
    const tableId = req.query.tableId ? parseInt(String(req.query.tableId)) : null;

    const conditions: any[] = [];
    if (player) conditions.push(ilike(blackjackHandsTable.playerName, `%${player}%`));
    if (result && result !== "all") conditions.push(eq(blackjackHandsTable.result, result));
    if (tableId) conditions.push(eq(blackjackHandsTable.tableId, tableId));

    const rows = await db.select()
      .from(blackjackHandsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(blackjackHandsTable.playedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(blackjackHandsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ hands: rows, total: count });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Server error" });
  }
});

export default router;
