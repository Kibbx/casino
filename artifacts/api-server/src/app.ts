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

// Explicit CORS — must be before all routes so preflight OPTIONS responses are
// handled by Express rather than falling through to Nginx or other proxies.
// `origin: true` reflects the request Origin back (required when credentials are
// sent). `credentials: true` is needed so Authorization headers are permitted.
app.use(cors({
  origin: (requestOrigin, callback) => {
    if (process.env.NODE_ENV !== "production") {
      // Development: allow any origin (Vite dev server, Replit proxy, etc.)
      callback(null, requestOrigin ?? true);
      return;
    }
    // Production: same-origin requests have no Origin header — always allow.
    if (!requestOrigin) { callback(null, true); return; }
    // Allow explicit extra origins via ALLOWED_ORIGINS="https://a.com,https://b.com"
    const allowed = (process.env.ALLOWED_ORIGINS ?? "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (allowed.includes(requestOrigin)) { callback(null, requestOrigin); return; }
    callback(new Error("CORS: origin not permitted"));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Content-Type"],
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 204,
}));

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

  // Static asset extensions — if a request matches one of these and isn't found
  // by the static middleware, it must return 404 (never index.html).
  const ASSET_EXT = /\.(webp|png|jpg|jpeg|gif|svg|ico|mp3|mp4|wav|ogg|woff2?|ttf|eot|pdf|txt|xml|map)$/i;

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

  // Vite-hashed bundles — long cache, they change filename on every build
  app.use("/assets", express.static(path.join(casinoDist, "assets"), { maxAge: "7d", immutable: true }));

  // Static files served at root path  (builds with BASE_PATH=/)
  app.use(express.static(casinoDist, { maxAge: "5m" }));

  // Also serve at /casino prefix in case the build used BASE_PATH=/casino/
  // This ensures image requests like /casino/rome-slots/screen/BKG.webp resolve
  // to dist/public/rome-slots/screen/BKG.webp instead of hitting the SPA fallback.
  app.use("/casino", express.static(casinoDist, { maxAge: "5m" }));

  // SPA fallback — serves index.html ONLY for non-asset paths.
  // Asset extensions (images, fonts, media) that reach here are genuinely missing:
  // return 404 so the browser shows a broken-image icon, not a silent 200/text:html.
  app.use((req, res) => {
    if (ASSET_EXT.test(req.path)) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(indexFile);
  });
}

export default app;
