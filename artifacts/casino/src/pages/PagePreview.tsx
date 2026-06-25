/**
 * PagePreview — renders the REAL casino page components at /page-preview/:key.
 * No authentication required. Uses a fake player session so the pages render
 * their full UI layout without redirecting to /login.
 *
 * Used by the Banker region editor's scaled iframe preview.
 * Reference viewport: 1920 × 1080 px (matches VisualRegionEditor REF_W/REF_H).
 */
import { useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setUnauthorizedHandler } from "@workspace/api-client-react";
import { useRoute } from "wouter";
import { useStore } from "../store";

// Real page components — the exact same ones players see
import Home from "./home";
import Lobby from "./lobby";
import Roulette from "./roulette";
import Blackjack from "./blackjack";
import SlotsHub from "./slots-hub";
import Crash from "./crash";
import TournamentsListPage from "./tournaments-list";

// ── Isolated query client for preview ─────────────────────────────────────────
// Never retries, never refetches — layout renders from first data snapshot
const previewQC = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

// ── Fake player ID used only in the preview iframe ────────────────────────────
// This value is injected into the Zustand store so page components don't
// hit the `if (!playerId) return null` guard.  All API calls with this fake
// session token return 401, which is swallowed by the no-op unauthorized handler.
const PREVIEW_PLAYER_ID = 8_888_888;

// ── Provider wrapper ──────────────────────────────────────────────────────────
function PreviewProvider({ children }: { children: React.ReactNode }) {
  // Run synchronously during the first render — BEFORE any children render.
  // This ensures child components see a valid playerId on their first render
  // and never fire the `if (!playerId) setLocation("/login")` redirect.
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;

    // 1. Swallow 401 responses so the fake session is never cleared
    setUnauthorizedHandler(() => {});

    // 2. Inject fake player before any child component renders
    useStore.setState({
      playerId: PREVIEW_PLAYER_ID as unknown as number,
      username: "Preview",
      sessionToken: "preview-readonly",
      chips: 25_000,
      playerStaffRole: null,
    } as any);

  }

  return (
    <QueryClientProvider client={previewQC}>
      {children}
    </QueryClientProvider>
  );
}

// ── Page map ──────────────────────────────────────────────────────────────────
const PAGE_MAP: Record<string, React.ComponentType> = {
  homepage:    Home,
  lobby:       Lobby,
  roulette:    Roulette,
  blackjack:   Blackjack,
  slots:       SlotsHub,
  crash:       Crash,
  tournaments: TournamentsListPage,
};

// ── Route component ───────────────────────────────────────────────────────────
export default function PagePreview() {
  const [, params] = useRoute("/page-preview/:key");
  const key = params?.key ?? "lobby";
  const Page = PAGE_MAP[key] ?? Lobby;

  return (
    <PreviewProvider>
      {/* Fixed 1920×1080 reference viewport — region editor scales it to fill the panel */}
      <div style={{ width: 1920, minHeight: 1080, overflow: "hidden", pointerEvents: "none" }}>
        <Page />
      </div>
    </PreviewProvider>
  );
}
