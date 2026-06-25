import path from "path";
import fs from "fs";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import router from "./routes";
import { reqStatsMiddleware } from "./lib/req-stats.js";

export const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

export const AVATAR_UPLOADS_DIR = path.join(UPLOADS_BASE, "avatars");
export const SECURITY_PHOTOS_DIR = path.join(UPLOADS_BASE, "security-photos");

fs.mkdirSync(AVATAR_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(SECURITY_PHOTOS_DIR, { recursive: true });

const app: Express = express();

app.use(compression());
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(reqStatsMiddleware);

app.use("/api/uploads", express.static(UPLOADS_BASE, { maxAge: "30d" }));
app.use("/api", router);

// Global JSON error handler — must come after routes and before SPA fallback
// This ensures errors from body parsers (payload-too-large, etc.) return JSON, not HTML
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";
  console.error(`[error] ${status} ${message}`, err.type ?? "");
  res.status(status).json({ error: message });
});

if (process.env.NODE_ENV === "production") {
  const casinoDist = path.resolve(process.cwd(), "artifacts/casino/dist/public");
  const indexFile = path.join(casinoDist, "index.html");

  // index.html — never cache so deploys are immediately visible
  app.use((req, res, next) => {
    if (req.path === "/" || req.path === "/index.html") {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.sendFile(indexFile);
    }
    next();
  });

  // Vite-hashed bundles (assets/ dir) — safe to cache long-term, they change filename on every build
  app.use("/assets", express.static(path.join(casinoDist, "assets"), { maxAge: "7d", immutable: true }));

  // Public files with fixed names (images/, fonts, etc.) — short cache so replacements are seen quickly
  app.use(express.static(casinoDist, { maxAge: "5m", immutable: false }));

  // SPA fallback — also no-cache
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(indexFile);
  });
}

export default app;
