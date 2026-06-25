import { pgTable, serial, integer, varchar, text, boolean, timestamp, real } from "drizzle-orm/pg-core";

export const promoRegionsTable = pgTable("promo_regions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  pageKey: varchar("page_key", { length: 50 }).notNull(),
  x: real("x").notNull().default(10),
  y: real("y").notNull().default(10),
  width: real("width").notNull().default(30),
  height: real("height").notNull().default(15),
  isActive: boolean("is_active").notNull().default(true),
  desktopVisible: boolean("desktop_visible").notNull().default(true),
  mobileVisible: boolean("mobile_visible").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PromoRegion = typeof promoRegionsTable.$inferSelect;
export type InsertPromoRegion = typeof promoRegionsTable.$inferInsert;

export const promoAssetsTable = pgTable("promo_assets", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  imageUrl: varchar("image_url", { length: 500 }).notNull(),
  targetUrl: varchar("target_url", { length: 500 }),
  uploadedBy: varchar("uploaded_by", { length: 100 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PromoAsset = typeof promoAssetsTable.$inferSelect;
export type InsertPromoAsset = typeof promoAssetsTable.$inferInsert;

export const promoPlacementsTable = pgTable("promo_placements", {
  id: serial("id").primaryKey(),
  regionId: integer("region_id").notNull(),
  assetId: integer("asset_id").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PromoPlacement = typeof promoPlacementsTable.$inferSelect;
export type InsertPromoPlacement = typeof promoPlacementsTable.$inferInsert;
