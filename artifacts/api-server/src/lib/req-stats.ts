import type { Request, Response, NextFunction } from "express";

interface RouteStat {
  total: number;
  last60s: number[];
}

const routeStats = new Map<string, RouteStat>();
let totalRequests = 0;
let wsConnections = 0;
const startTime = Date.now();

const WINDOW_MS = 60_000;

function bucket(): RouteStat {
  return { total: 0, last60s: [] };
}

export function reqStatsMiddleware(req: Request, _res: Response, next: NextFunction) {
  const key = `${req.method} ${req.path.replace(/\/\d+/g, "/:id")}`;
  const now = Date.now();

  if (!routeStats.has(key)) routeStats.set(key, bucket());
  const stat = routeStats.get(key)!;

  stat.total++;
  stat.last60s.push(now);
  totalRequests++;

  next();
}

export function trackWsConnect() { wsConnections++; }
export function trackWsDisconnect() { wsConnections = Math.max(0, wsConnections - 1); }

export function getApiStats() {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const uptimeSec = Math.round((now - startTime) / 1000);

  const routes: Record<string, { total: number; perMin: number }> = {};
  let totalPerMin = 0;

  for (const [key, stat] of routeStats.entries()) {
    stat.last60s = stat.last60s.filter((t) => t > cutoff);
    const perMin = stat.last60s.length;
    totalPerMin += perMin;
    routes[key] = { total: stat.total, perMin };
  }

  const sorted = Object.fromEntries(
    Object.entries(routes).sort((a, b) => b[1].total - a[1].total)
  );

  return {
    uptimeSeconds: uptimeSec,
    totalRequests,
    requestsPerMin: totalPerMin,
    wsConnections,
    routes: sorted,
  };
}
