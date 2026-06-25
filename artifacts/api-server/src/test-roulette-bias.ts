/**
 * Roulette bias verification test
 * Run with:  npx tsx src/test-roulette-bias.ts
 *
 * Tests:
 *  1. spinWheel — green frequency per mode (warm/hot suppress green, others don't)
 *  2. Standard mode: chi-squared distribution test (no pocket bias)
 *  3. Cold/cool pocket-forcing logic (zero-payout pocket detection)
 *  4. Warm/hot re-spin only suppresses green — non-green pockets stay uniform
 */

import { spinWheel, evaluateAllBets, type Bet } from "./lib/roulette-engine.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPINS      = 200_000;
const EU_POCKETS = 37; // 0..36

let failures = 0;

function pct(n: number, d: number) { return ((n / d) * 100).toFixed(2) + "%"; }

function assertApprox(label: string, actual: number, expected: number, tolerance: number) {
  const pass = Math.abs(actual - expected) <= tolerance;
  const status = pass ? "✅ PASS" : "❌ FAIL";
  console.log(`  ${status} ${label}: got ${pct(actual, 1)}, expected ~${pct(expected, 1)} ± ${pct(tolerance, 1)}`);
  if (!pass) failures++;
}

function assertTrue(label: string, val: boolean) {
  const status = val ? "✅ PASS" : "❌ FAIL";
  console.log(`  ${status} ${label}`);
  if (!val) failures++;
}

// ── Test 1: Green frequency per mode ─────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════");
console.log(` TEST 1: Green-pocket frequency per mode (${SPINS.toLocaleString()} spins each)`);
console.log("═══════════════════════════════════════════════════════════");

const theoreticalGreen = 1 / EU_POCKETS; // ~2.703%

for (const mode of ["cold", "cool", "standard", "warm", "hot"] as const) {
  let greens = 0;
  for (let i = 0; i < SPINS; i++) {
    if (spinWheel("european", mode) === 0) greens++;
  }
  const rate = greens / SPINS;
  console.log(`\n  Mode: ${mode.toUpperCase()} — ${greens.toLocaleString()} greens`);

  if (mode === "standard" || mode === "cold" || mode === "cool") {
    // spinWheel itself applies no cold/cool bias (that's upstream in roulette-room.ts)
    assertApprox(
      "Green rate ≈ 1/37 (unbiased from spinWheel itself)",
      rate, theoreticalGreen, 0.003
    );
  }
  if (mode === "warm") {
    const expected = theoreticalGreen * (1 - 0.33);
    assertApprox(
      "Green rate ≈ 1/37 × 0.67 (warm: 33% re-spin on green)",
      rate, expected, 0.003
    );
  }
  if (mode === "hot") {
    const expected = theoreticalGreen * (1 - 0.65);
    assertApprox(
      "Green rate ≈ 1/37 × 0.35 (hot: 65% re-spin on green)",
      rate, expected, 0.003
    );
  }
}

// ── Test 2: Standard mode chi-squared (no systematic bias) ───────────────────

console.log("\n═══════════════════════════════════════════════════════════");
console.log(` TEST 2: Standard mode — chi-squared pocket distribution`);
console.log("═══════════════════════════════════════════════════════════");

const pocketCounts = new Array(EU_POCKETS).fill(0);
for (let i = 0; i < SPINS; i++) {
  const r = spinWheel("european", "standard");
  if (r >= 0 && r < EU_POCKETS) pocketCounts[r]++;
}
const expected = SPINS / EU_POCKETS;
const chi2 = pocketCounts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
// χ² critical at df=36, p=0.001 is 66.2 — below → fair
assertTrue(`χ²=${chi2.toFixed(1)} < 66.2 (distribution is statistically fair)`, chi2 < 66.2);

// ── Test 3: Cold/cool pocket-forcing logic ────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════");
console.log(` TEST 3: Cold/cool losing-pocket detection`);
console.log("═══════════════════════════════════════════════════════════");

const allPockets = Array.from({ length: EU_POCKETS }, (_, i) => i);

// 3A: Red bet → 19 losing pockets (0 + 18 black numbers)
const redBet: Bet = { type: "red", numbers: [], amount: 100 };
const lostVsRed = allPockets.filter(p =>
  evaluateAllBets([redBet], p).reduce((s, r) => s + r.payout, 0) === 0
);
assertTrue(`Red bet → ${lostVsRed.length} losing pockets (expected 19)`, lostVsRed.length === 19);
assertTrue("Pocket 0 (green) is a losing pocket for red bet", lostVsRed.includes(0));
assertTrue("Pocket 2 (black) is a losing pocket for red bet", lostVsRed.includes(2));
assertTrue("Pocket 1 (red) is NOT a losing pocket for red bet", !lostVsRed.includes(1));

// 3B: Straight-up on pocket 7 → 36 losing pockets (everything except 7)
const straight7: Bet = { type: "straight", numbers: [7], amount: 100 };
const lostVs7 = allPockets.filter(p =>
  evaluateAllBets([straight7], p).reduce((s, r) => s + r.payout, 0) === 0
);
assertTrue(`Straight on 7 → ${lostVs7.length} losing pockets (expected 36)`, lostVs7.length === 36);
assertTrue("Pocket 7 is NOT a losing pocket", !lostVs7.includes(7));

// 3C: All 37 pockets covered with straight bets → 0 losing pockets (bias can't fire)
const allCovered: Bet[] = allPockets.map(p => ({ type: "straight" as const, numbers: [p], amount: 10 }));
const lostAllCovered = allPockets.filter(p =>
  evaluateAllBets(allCovered, p).reduce((s, r) => s + r.payout, 0) === 0
);
assertTrue(
  `All pockets covered → ${lostAllCovered.length} losing pockets (cold bias can't fire)`,
  lostAllCovered.length === 0
);

// 3D: Two conflicting bets (red + black) → 1 losing pocket (only 0)
const redAndBlack: Bet[] = [
  { type: "red",   numbers: [], amount: 100 },
  { type: "black", numbers: [], amount: 100 },
];
const lostRedAndBlack = allPockets.filter(p =>
  evaluateAllBets(redAndBlack, p).reduce((s, r) => s + r.payout, 0) === 0
);
assertTrue(
  `Red + Black → ${lostRedAndBlack.length} losing pocket (expected 1: only green)`,
  lostRedAndBlack.length === 1
);
assertTrue("That pocket is 0 (green)", lostRedAndBlack[0] === 0);

// ── Test 4: Warm/hot suppresses ONLY green, non-green stays uniform ───────────

console.log("\n═══════════════════════════════════════════════════════════");
console.log(` TEST 4: Hot mode — non-green pockets stay uniformly distributed`);
console.log("═══════════════════════════════════════════════════════════");

const SAMPLE = 100_000;
const hotCounts = new Array(EU_POCKETS).fill(0);
for (let i = 0; i < SAMPLE; i++) {
  const r = spinWheel("european", "hot");
  if (r >= 0 && r < EU_POCKETS) hotCounts[r]++;
}

// Green (pocket 0) should be heavily suppressed
const greenRate = hotCounts[0] / SAMPLE;
assertTrue(
  `Hot: pocket 0 rate ${pct(hotCounts[0], SAMPLE)} < half of 1/37 (green is suppressed)`,
  greenRate < theoreticalGreen * 0.6
);

// Non-green pockets 1–36 should be uniform RELATIVE TO EACH OTHER.
// Re-spins from green land on all 37 pockets equally, so non-green counts are
// slightly elevated above SAMPLE/37 — that's correct. We measure uniformity
// among themselves using their own mean as the expected value.
const nonGreenSlice = hotCounts.slice(1);
const nonGreenMean = nonGreenSlice.reduce((s, c) => s + c, 0) / nonGreenSlice.length;
const nonGreenChi2 = nonGreenSlice.reduce((s, c) => s + (c - nonGreenMean) ** 2 / nonGreenMean, 0);
// df=35, p=0.001 critical ≈ 63.7
assertTrue(
  `Non-green pockets stay uniform among themselves in hot mode (χ²=${nonGreenChi2.toFixed(1)} < 63.7)`,
  nonGreenChi2 < 63.7
);

// Same check for warm
const warmCounts = new Array(EU_POCKETS).fill(0);
for (let i = 0; i < SAMPLE; i++) {
  const r = spinWheel("european", "warm");
  if (r >= 0 && r < EU_POCKETS) warmCounts[r]++;
}
const warmGreenRate = warmCounts[0] / SAMPLE;
assertTrue(
  `Warm: pocket 0 rate ${pct(warmCounts[0], SAMPLE)} < 85% of 1/37 (green is mild-suppressed)`,
  warmGreenRate < theoreticalGreen * 0.85
);
const warmNonGreenChi2 = warmCounts.slice(1).reduce((s, c) => {
  return s + (c - SAMPLE / EU_POCKETS) ** 2 / (SAMPLE / EU_POCKETS);
}, 0);
assertTrue(
  `Non-green pockets stay uniform in warm mode (χ²=${warmNonGreenChi2.toFixed(1)} < 63.7)`,
  warmNonGreenChi2 < 63.7
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════");
if (failures > 0) {
  console.log(` RESULT: ❌  ${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(" RESULT: ✅  All roulette bias tests PASSED");
  console.log("  • Standard mode:  no pocket bias (fair chi-squared)");
  console.log("  • Cold/cool bias: pocket-forcing only hits true losing pockets");
  console.log("  • Warm/hot bias:  only green is suppressed, others stay uniform");
}
console.log("═══════════════════════════════════════════════════════════\n");
