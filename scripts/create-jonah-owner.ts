import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, bankerAccountsTable } from "@workspace/db";

async function main() {
  const password = process.env.JONAH_OWNER_PASSWORD;
  if (!password) {
    console.error("[ERROR] JONAH_OWNER_PASSWORD env var not set");
    process.exit(1);
  }

  const username = "jonah";
  const hash = await bcrypt.hash(password, 12);

  // Check if account already exists
  const existing = await db.select().from(bankerAccountsTable).where(eq(bankerAccountsTable.username, username));
  if (existing.length > 0) {
    await db
      .update(bankerAccountsTable)
      .set({
        passwordHash: hash,
        isActive: true,
        isAdmin: true,
        role: "owner",
        role2: null,
        rolesJson: JSON.stringify(["owner"]),
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(bankerAccountsTable.username, username));
    console.log(`[OK] Updated existing banker account "${username}" with owner role`);
  } else {
    await db.insert(bankerAccountsTable).values({
      username,
      passwordHash: hash,
      isActive: true,
      isAdmin: true,
      role: "owner",
      role2: null,
      rolesJson: JSON.stringify(["owner"]),
      stateId: null, // could link to player's state_id if needed
      failedAttempts: 0,
    });
    console.log(`[OK] Created owner banker account "${username}"`);
  }

  const list = await db.select().from(bankerAccountsTable).where(eq(bankerAccountsTable.username, username));
  console.log(JSON.stringify(list, null, 2));
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
