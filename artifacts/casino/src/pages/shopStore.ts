/**
 * shopStore — single source of truth for the Shops mock data.
 * Structured for future API replacement: swap getShops() / deleteShop()
 * with real API calls and nothing else needs to change.
 */

export type Rarity   = "Common" | "Rare" | "Epic" | "Legendary" | "Mythic";
export type Category = "Sneakers" | "Watches" | "Trading Cards" | "Electronics" | "Apparel" | "Car Parts";

export interface Shop {
  slug:         string;
  name:         string;
  seller:       string;
  avatar:       string;
  accent:       string;
  desc:         string;
  listings:     number;
  sales:        number;
  rating:       number;
  category:     Category;
  followers:    number;
  verified:     boolean;
  banner:       string;
  featured:     number[];
  sections:     string[];
  announcement?: string;
}

/* ── Seed data ──────────────────────────────────────────────────── */
const SEED_SHOPS: Shop[] = [
  {
    slug: "sole-supply-nyc", name: "Sole Supply NYC", seller: "SoleSupply_NYC",
    avatar: "👟", accent: "#e8400a",
    banner: "linear-gradient(135deg,#1a0800 0%,#3d1200 50%,#1a0800 100%)",
    desc: "Premium deadstock sneakers. Jordan, Nike, Adidas. Same-day shipping on all orders.",
    listings: 42, sales: 1240, rating: 4.9, category: "Sneakers", followers: 892, verified: true,
    featured: [1, 2, 5], sections: ["New Drops", "Jordan Vault", "Best Sellers"],
    announcement: "🔥 Flash sale this weekend — 10% off all Jordans.",
  },
  {
    slug: "card-vault", name: "Card Vault", seller: "CardVault",
    avatar: "🃏", accent: "#60a5fa",
    banner: "linear-gradient(135deg,#000d1a 0%,#001e3d 50%,#000d1a 100%)",
    desc: "PSA graded trading cards. Pokémon, NBA, NFL. Every card authenticated and verified.",
    listings: 67, sales: 3400, rating: 5.0, category: "Trading Cards", followers: 2310, verified: true,
    featured: [11, 13, 14], sections: ["PSA 10s", "Rare Finds", "New Listings"],
    announcement: "⚡ New PSA 10 Charizards just dropped — limited stock.",
  },
  {
    slug: "precision-time", name: "Precision Time", seller: "PrecisionTime",
    avatar: "⌚", accent: "#f5c518",
    banner: "linear-gradient(135deg,#1a1400 0%,#332900 50%,#1a1400 100%)",
    desc: "Luxury and sport timepieces. Every watch verified, documented, and box-fresh.",
    listings: 18, sales: 890, rating: 4.8, category: "Watches", followers: 1450, verified: true,
    featured: [7, 9, 10], sections: ["Luxury Tier", "Sport Watches", "Recent Arrivals"],
  },
  {
    slug: "tech-resell", name: "TechResell Pro", seller: "TechResell",
    avatar: "📱", accent: "#06b6d4",
    banner: "linear-gradient(135deg,#000e14 0%,#001e2a 50%,#000e14 100%)",
    desc: "Unlocked smartphones, laptops, and gaming gear. Grade A condition guaranteed.",
    listings: 54, sales: 2780, rating: 4.7, category: "Electronics", followers: 1830, verified: true,
    featured: [15, 16, 17], sections: ["Phones", "Gaming", "Best Sellers"],
  },
  {
    slug: "hype-drop", name: "Hype Drop", seller: "HypeDrop",
    avatar: "👕", accent: "#a855f7",
    banner: "linear-gradient(135deg,#0e0014 0%,#1e0035 50%,#0e0014 100%)",
    desc: "Supreme, Off-White, Palace. Exclusive streetwear. All items deadstock and verified.",
    listings: 31, sales: 1560, rating: 4.6, category: "Apparel", followers: 3210, verified: false,
    featured: [19, 20, 22], sections: ["Supreme", "Collab Pieces", "New Drops"],
    announcement: "📦 Box Logo restock incoming — follow to get notified.",
  },
  {
    slug: "apex-parts", name: "Apex Parts", seller: "ApexParts",
    avatar: "🌀", accent: "#ef4444",
    banner: "linear-gradient(135deg,#1a0000 0%,#2d0000 50%,#1a0000 100%)",
    desc: "Performance auto parts, turbos, suspension, and track upgrades. Ship worldwide.",
    listings: 23, sales: 670, rating: 4.9, category: "Car Parts", followers: 540, verified: true,
    featured: [23, 24, 25], sections: ["Turbos", "Suspension", "Wheels"],
  },
  {
    slug: "jonahs-vault", name: "Jonah's Vault", seller: "Jonah_Hydell",
    avatar: "🏆", accent: "#f97316",
    banner: "linear-gradient(135deg,#1a0800 0%,#2d1200 50%,#1a0800 100%)",
    desc: "Hand-picked collectibles and rare finds. Every item personally vetted by the owner.",
    listings: 15, sales: 480, rating: 4.8, category: "Trading Cards", followers: 721, verified: false,
    featured: [11, 14, 13], sections: ["Rare Finds", "Best Sellers"],
    announcement: "✨ New arrivals every Friday — check back weekly.",
  },
];

/* ── Storage keys ───────────────────────────────────────────────── */
const DELETED_KEY = "bhm_deleted_slugs";
const TOAST_KEY   = "bhm_pending_delete_toast";

/* ── Helpers ────────────────────────────────────────────────────── */
function loadDeletedSlugs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveDeletedSlugs(slugs: Set<string>): void {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify([...slugs])); } catch { /* no-op */ }
}

/* ── In-memory working list (initialised once per session) ──────── */
let _shops: Shop[] = SEED_SHOPS.filter(s => !loadDeletedSlugs().has(s.slug));

/* ── Public API ─────────────────────────────────────────────────── */

/** Return a snapshot of all live (non-deleted) shops. */
export function getShops(): Shop[] {
  return [..._shops];
}

/**
 * Delete a shop by slug.
 * Returns true if the shop was found and removed, false if it was already gone.
 * Structured so the body of the try block can be replaced with a real API call.
 */
export async function deleteShop(slug: string): Promise<boolean> {
  console.info(`[shopStore] deleteShop("${slug}") requested — current list:`, _shops.map(s => s.slug));

  // ── Mock: simulate network latency ────────────────────────────────
  // Replace with: const res = await fetch(`/api/shops/${slug}`, { method: "DELETE" });
  // if (!res.ok) throw new Error(`DELETE /api/shops/${slug} → ${res.status}`);
  await new Promise<void>(resolve => setTimeout(resolve, 1500));
  // ── End mock ───────────────────────────────────────────────────────

  const before = _shops.length;
  _shops = _shops.filter(s => s.slug !== slug);

  if (_shops.length === before) {
    console.warn(`[shopStore] deleteShop("${slug}") — slug not found, nothing removed`);
    return false;
  }

  // Persist so the shop stays gone after page navigation
  const deleted = loadDeletedSlugs();
  deleted.add(slug);
  saveDeletedSlugs(deleted);

  // Set a toast message the Shops page will pick up on next render
  try { localStorage.setItem(TOAST_KEY, slug); } catch { /* no-op */ }

  console.info(`[shopStore] deleteShop("${slug}") ✓ — ${_shops.length} shops remaining`, _shops.map(s => s.slug));
  return true;
}

/** Find a shop by slug (returns undefined if deleted or not found). */
export function getShopBySlug(slug: string): Shop | undefined {
  return _shops.find(s => s.slug === slug);
}

/**
 * Consume the pending "stall deleted" toast.
 * Returns the deleted slug, or null if no toast is pending.
 * Call once on the Shops page mount; it clears itself.
 */
export function consumePendingToast(): string | null {
  try {
    const slug = localStorage.getItem(TOAST_KEY);
    if (slug) {
      localStorage.removeItem(TOAST_KEY);
      // Find name from seed data for the toast message
      const shop = SEED_SHOPS.find(s => s.slug === slug);
      return shop?.name ?? slug;
    }
  } catch { /* no-op */ }
  return null;
}
