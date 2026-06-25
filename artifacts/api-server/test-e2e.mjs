/**
 * Back Alley Bets — end-to-end test
 * Tests: auth, chip grants, table create/join, multiplayer hand, actions,
 *        rake, chip balance accuracy, WebSocket single-connection multiplexing.
 */
import WebSocket from "ws";

const BASE = "http://localhost:8080";
const WS_BASE = "ws://localhost:8080";
const BANKER_PASSWORD = process.env.BANKER_ADMIN_PASSWORD;

if (!BANKER_PASSWORD) {
  console.error("BANKER_ADMIN_PASSWORD env var not set");
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Open a single multiplexed WS connection, subscribe to multiple channels,
// collect messages by type for `durationMs`, then close.
function openMuxWs(subscriptions, durationMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/api/ws`);
    const received = [];

    ws.on("open", () => {
      for (const sub of subscriptions) ws.send(JSON.stringify(sub));
    });

    ws.on("message", (data) => {
      try { received.push(JSON.parse(data.toString())); } catch {}
    });

    setTimeout(() => {
      ws.close();
      resolve(received);
    }, durationMs);
  });
}

// ── test suite ────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n════════════════════════════════════════");
  console.log("  Back Alley Bets — E2E Test Suite");
  console.log("════════════════════════════════════════\n");

  // ── 1. Banker login ────────────────────────────────────────────────────────
  console.log("1. Banker authentication");
  const bLogin = await api("POST", "/api/banker/login", { username: "admin", password: BANKER_PASSWORD });
  ok("banker login returns 200", bLogin.status === 200);
  ok("banker token present", !!bLogin.body.token);
  const bankerToken = bLogin.body.token;

  // ── 2. Register two test players ───────────────────────────────────────────
  console.log("\n2. Player registration");
  const suffix = Date.now();

  const p1Reg = await api("POST", "/api/players/register", {
    username: `alice_${suffix}`,
    stateId: `A${suffix}`,
    phoneNumber: `555-000-${suffix.toString().slice(-4)}`,
    pin: "1234",
  });
  ok(`alice registers (${p1Reg.status})`, p1Reg.status === 201);
  const alice = p1Reg.body;

  const p2Reg = await api("POST", "/api/players/register", {
    username: `bob_${suffix}`,
    stateId: `B${suffix}`,
    phoneNumber: `555-001-${suffix.toString().slice(-4)}`,
    pin: "1234",
  });
  ok(`bob registers (${p2Reg.status})`, p2Reg.status === 201);
  const bob = p2Reg.body;

  // Registration returns a sessionToken directly — use it
  const aliceToken = p1Reg.body.sessionToken;
  const bobToken   = p2Reg.body.sessionToken;
  ok("alice has session token", !!aliceToken);
  ok("bob has session token",   !!bobToken);

  // ── 3. Player login ────────────────────────────────────────────────────────
  console.log("\n3. Player login (stateId + pin)");
  const p1Login = await api("POST", "/api/players/login", {
    stateId: `A${suffix}`,
    pin: "1234",
  });
  ok("alice login 200", p1Login.status === 200);

  const p2Login = await api("POST", "/api/players/login", {
    stateId: `B${suffix}`,
    pin: "1234",
  });
  ok("bob login 200", p2Login.status === 200);

  // ── 4. Banker grants chips ─────────────────────────────────────────────────
  console.log("\n4. Chip grants");
  const ALICE_GRANT = 5000;
  const BOB_GRANT = 3000;

  const aliceGrant = await api("POST", `/api/players/${alice.id}/chips`, {
    amount: ALICE_GRANT,
    note: "e2e test grant",
  }, bankerToken);
  ok("alice chip grant 200", aliceGrant.status === 200);

  const bobGrant = await api("POST", `/api/players/${bob.id}/chips`, {
    amount: BOB_GRANT,
    note: "e2e test grant",
  }, bankerToken);
  ok("bob chip grant 200", bobGrant.status === 200);

  // Verify balances via API
  const aliceProfile = await api("GET", `/api/players/${alice.id}`, null, aliceToken);
  ok("alice balance == 5000", Number(aliceProfile.body.chips) === ALICE_GRANT);

  const bobProfile = await api("GET", `/api/players/${bob.id}`, null, bobToken);
  ok("bob balance == 3000", Number(bobProfile.body.chips) === BOB_GRANT);

  // ── 5. Create a poker table ────────────────────────────────────────────────
  console.log("\n5. Table creation");
  const tableRes = await api("POST", "/api/tables", {
    name: `E2E Table ${suffix}`,
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 200,
    maxBuyIn: 1000,
    rakePercent: 5,
    rakeCap: 50,
  }, bankerToken);
  ok("table created 201", tableRes.status === 201);
  const tableId = tableRes.body.id;
  ok("table has id", typeof tableId === "number");

  // ── 6. Players join and sit ────────────────────────────────────────────────
  console.log("\n6. Buy-ins & seating");
  const ALICE_BUYIN = 500;
  const BOB_BUYIN = 400;

  const joinAlice = await api("POST", `/api/tables/${tableId}/join`, {
    seatIndex: 0,
    buyIn: ALICE_BUYIN,
  }, aliceToken);
  ok("alice joins seat 0", joinAlice.status === 200);

  const joinBob = await api("POST", `/api/tables/${tableId}/join`, {
    seatIndex: 1,
    buyIn: BOB_BUYIN,
  }, bobToken);
  ok("bob joins seat 1", joinBob.status === 200);

  // Chip balance should reflect buy-ins (deducted from wallet)
  const aliceAfterJoin = await api("GET", `/api/players/${alice.id}`, null, aliceToken);
  ok(`alice wallet reduced by buy-in: ${aliceAfterJoin.body.chips}`,
    Number(aliceAfterJoin.body.chips) === ALICE_GRANT - ALICE_BUYIN);

  const bobAfterJoin = await api("GET", `/api/players/${bob.id}`, null, bobToken);
  ok(`bob wallet reduced by buy-in: ${bobAfterJoin.body.chips}`,
    Number(bobAfterJoin.body.chips) === BOB_GRANT - BOB_BUYIN);

  // ── 7. WebSocket — single shared connection carries all 3 channels ─────────
  console.log("\n7. WebSocket multiplexing (single connection, 3 channels)");

  // Collect WS messages for 3 seconds using a single connection subscribed to
  // table + player + lobby simultaneously.
  const wsMessages = await openMuxWs([
    { type: "subscribe", tableId, playerId: alice.id },
    { type: "subscribe_player", playerId: alice.id, token: aliceToken },
    { type: "subscribe_lobby" },
  ], 3000);

  const types = wsMessages.map((m) => m.type);
  ok("got subscribed confirmation", types.includes("subscribed"));
  ok("got player_subscribed confirmation", types.includes("player_subscribed"));
  ok("got lobby_subscribed confirmation", types.includes("lobby_subscribed"));

  // ── 8. Start a hand and play through it ───────────────────────────────────
  console.log("\n8. Multiplayer hand: start & play");

  // Wait for auto-start (2 players seated, 5s delay) — or we can manually start
  const startRes = await api("POST", `/api/tables/${tableId}/start`, {}, aliceToken);
  ok("hand starts", startRes.status === 200);

  // Fetch table state to understand who acts first
  const tableState = await api("GET", `/api/tables/${tableId}`, null, aliceToken);
  ok("table state fetched", tableState.status === 200);

  const gs = tableState.body.gameState;
  ok("game is in progress", gs && gs.phase !== undefined);
  ok("community cards present", Array.isArray(gs.communityCards));
  ok("pot > 0 from blinds", Number(gs.pot) > 0);
  ok(`pot = sb+bb (${gs.pot})`, Number(gs.pot) === 30); // 10+20

  const currentSeat = gs.currentPlayerSeat;
  ok("currentPlayerSeat is valid", typeof currentSeat === "number");

  const seats = tableState.body.seats;
  const aliceSeat = seats.find((s) => s.playerId === alice.id);
  const bobSeat = seats.find((s) => s.playerId === bob.id);
  ok("alice seated", !!aliceSeat);
  ok("bob seated", !!bobSeat);

  // Figure out active actor
  const actingToken = currentSeat === aliceSeat.seatIndex ? aliceToken : bobToken;
  const actingName = currentSeat === aliceSeat.seatIndex ? "alice" : "bob";
  console.log(`  → seat ${currentSeat} (${actingName}) acts first`);

  // Action: call the big blind (preflop call = match BB)
  const callRes = await api("POST", `/api/tables/${tableId}/action`, {
    action: "call",
  }, actingToken);
  ok(`${actingName} calls preflop`, callRes.status === 200);

  // Pot should now be 40 (BB called)
  const afterCall = await api("GET", `/api/tables/${tableId}`, null, aliceToken);
  const potAfterCall = Number(afterCall.body.gameState.pot);
  ok(`pot grew after call: ${potAfterCall}`, potAfterCall > 30);

  // Let the other player check
  const otherToken = actingToken === aliceToken ? bobToken : aliceToken;
  const otherName = actingName === "alice" ? "bob" : "alice";

  const checkRes = await api("POST", `/api/tables/${tableId}/action`, {
    action: "check",
  }, otherToken);
  ok(`${otherName} checks`, checkRes.status === 200);

  // ── 9. Fold to end the hand quickly ────────────────────────────────────────
  console.log("\n9. Fold to end hand & verify chip reconciliation");

  // Keep acting until the hand ends (fold on next action)
  let handDone = false;
  let iterations = 0;

  while (!handDone && iterations < 20) {
    await sleep(300);
    const st = await api("GET", `/api/tables/${tableId}`, null, aliceToken);
    const phase = st.body.gameState?.phase;

    if (phase === "showdown" || phase === undefined || st.body.status !== "playing") {
      handDone = true;
      break;
    }

    const cs = st.body.gameState.currentSeat;
    const csToken = seats.find((s) => s.seatIndex === cs)?.playerId === alice.id
      ? aliceToken : bobToken;

    const foldRes = await api("POST", `/api/tables/${tableId}/action`, {
      action: "fold",
    }, csToken);

    if (foldRes.body?.gameState?.phase === "showdown" || foldRes.status !== 200) {
      handDone = true;
    }
    iterations++;
  }

  ok("hand completed", handDone || iterations < 20);

  // Wait a moment for DB writes to finish
  await sleep(500);

  // ── 10. Chip reconciliation ─────────────────────────────────────────────────
  console.log("\n10. Chip reconciliation");

  // Fetch final table state (has seat chip counts)
  const finalTable = await api("GET", `/api/tables/${tableId}`, null, aliceToken);
  const finalSeats = finalTable.body.seats;
  const finalAliceSeat = finalSeats.find((s) => s.playerId === alice.id);
  const finalBobSeat = finalSeats.find((s) => s.playerId === bob.id);

  const aliceChipsAtTable = Number(finalAliceSeat?.chips ?? 0);
  const bobChipsAtTable = Number(finalBobSeat?.chips ?? 0);
  const totalAtTable = aliceChipsAtTable + bobChipsAtTable;

  console.log(`  alice @ table: ${aliceChipsAtTable}`);
  console.log(`  bob @ table:   ${bobChipsAtTable}`);
  console.log(`  total @ table: ${totalAtTable}`);

  // Total chips at table should be <= buy-in total (rake may have been taken)
  const totalBuyIn = ALICE_BUYIN + BOB_BUYIN;
  ok(`total chips at table ≤ total buy-in (${totalAtTable} ≤ ${totalBuyIn})`, totalAtTable <= totalBuyIn);

  // Chips should be conserved: table chips + rake = total buy-in
  const rakePercent = 5;
  const rakeCap = 50;
  const maxExpectedRake = Math.min(Math.floor(40 * rakePercent / 100), rakeCap); // at most a few %
  ok(`chips conserved within rake bounds`, totalAtTable >= totalBuyIn - rakeCap);

  // ── 11. Leave table → chips return to wallet ────────────────────────────────
  console.log("\n11. Cash out → chips return to wallet");

  const leaveAlice = await api("POST", `/api/tables/${tableId}/leave`, {}, aliceToken);
  ok("alice leaves table", leaveAlice.status === 200);

  const leaveBob = await api("POST", `/api/tables/${tableId}/leave`, {}, bobToken);
  ok("bob leaves table", leaveBob.status === 200);

  await sleep(300);

  const aliceFinal = await api("GET", `/api/players/${alice.id}`, null, aliceToken);
  const bobFinal = await api("GET", `/api/players/${bob.id}`, null, bobToken);

  const aliceFinalChips = Number(aliceFinal.body.chips);
  const bobFinalChips = Number(bobFinal.body.chips);

  console.log(`  alice wallet after cash-out: ${aliceFinalChips}`);
  console.log(`  bob wallet after cash-out:   ${bobFinalChips}`);

  // Each player's total wallet = (grant - buy-in) + chips_they_had_at_table
  const aliceExpected = (ALICE_GRANT - ALICE_BUYIN) + aliceChipsAtTable;
  const bobExpected   = (BOB_GRANT   - BOB_BUYIN)   + bobChipsAtTable;

  ok(`alice wallet correct (${aliceFinalChips} == ${aliceExpected})`, aliceFinalChips === aliceExpected);
  ok(`bob wallet correct (${bobFinalChips} == ${bobExpected})`,   bobFinalChips === bobExpected);

  // Total chips in system should be conserved (± rake deducted to house)
  const totalBefore = ALICE_GRANT + BOB_GRANT;
  const totalAfter = aliceFinalChips + bobFinalChips;
  ok(`total chips in system ≤ total granted (${totalAfter} ≤ ${totalBefore})`, totalAfter <= totalBefore);
  ok(`chip loss = rake only (≤ rakeCap ${rakeCap})`, totalBefore - totalAfter <= rakeCap);

  // ── 12. Transaction ledger ─────────────────────────────────────────────────
  console.log("\n12. Transaction ledger");

  const aliceTx = await api("GET", `/api/players/${alice.id}/transactions`, null, aliceToken);
  ok("alice transactions 200", aliceTx.status === 200);
  ok("alice has transactions", Array.isArray(aliceTx.body) && aliceTx.body.length > 0);

  const txTypes = aliceTx.body.map((t) => t.type);
  console.log(`  alice tx types seen: ${[...new Set(txTypes)].join(", ")}`);
  ok("has buy-in transaction (loss)", txTypes.includes("loss"));
  ok("has cash-out or win transaction", txTypes.includes("win") || txTypes.includes("cash_out"));

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
