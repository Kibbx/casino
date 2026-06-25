import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Register from "@/pages/register";
import PlayerLogin from "@/pages/player-login";
import Lobby from "@/pages/lobby";
import TablePage from "@/pages/table";
import Blackjack from "@/pages/blackjack";
import { Redirect } from "wouter";
import Roulette from "@/pages/roulette";
import Baccarat from "@/pages/baccarat";
import HorseRacing from "@/pages/horse-racing";
import TournamentPage from "@/pages/tournament";
import TournamentsListPage from "@/pages/tournaments-list";
import SlotsTournamentPage from "@/pages/slots-tournament";
import BankerLogin from "@/pages/banker-login";
import BankerDashboard from "@/pages/banker";
import PokerLobby from "@/pages/poker-lobby";
import CasesPage from "@/pages/cases";
import MyRewardsPage from "@/pages/my-rewards";
import ProfilePage from "@/pages/profile";
import MinesPage from "@/pages/mines";
import KenoPage from "@/pages/keno";
import HighLow from "@/pages/high-low";
import SlotsHub from "@/pages/slots-hub";
import RomeSlots from "@/pages/rome-slots";
import WesternSlots from "@/pages/western-slots";
import MobTower from "@/pages/mob-tower";
import BingoPage from "@/pages/bingo";
import LotteryPage from "@/pages/lottery";
import MiniGamesPage from "@/pages/mini-games";
import LiveEventsPage from "@/pages/live-events";
import PagePreview from "@/pages/PagePreview";
import { setAuthTokenProvider, setUnauthorizedHandler } from "@workspace/api-client-react";
import { useStore } from "./store";
import { WsProvider } from "./lib/WsContext";
import { useVersionCheck } from "./lib/useVersionCheck";
import { GlobalDialogs } from "./components/GlobalDialogs";

setAuthTokenProvider(() => {
  const { sessionToken, bankerToken } = useStore.getState();
  return bankerToken || sessionToken || null;
});

// When any protected API call returns 401 while we have a stored token,
// the server session has expired (e.g. server restarted). Clear all local
// auth state so the page redirect logic sends the user back to login.
setUnauthorizedHandler(() => {
  const { logoutBanker, logoutPlayer } = useStore.getState();
  logoutBanker();
  logoutPlayer();
});

function ViewportDebug() {
  const [info, setInfo] = useState({ w: 0, h: 0, dpr: 1 });
  const [location] = useLocation();
  useEffect(() => {
    const update = () => setInfo({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  if (!new URLSearchParams(window.location.search).has("debug") &&
      window.location.search.indexOf("debug=viewport") === -1) return null;
  return (
    <div style={{
      position: "fixed", bottom: 8, right: 8, zIndex: 99999,
      background: "rgba(0,0,0,0.88)", border: "1px solid rgba(255,255,255,0.3)",
      borderRadius: 6, padding: "6px 10px", fontFamily: "monospace",
      fontSize: 12, color: "#7fff7f", lineHeight: 1.6, pointerEvents: "none",
      boxShadow: "0 2px 8px rgba(0,0,0,0.8)"
    }}>
      <div>viewport: {info.w} × {info.h}</div>
      <div>dpr: {info.dpr}</div>
      <div>route: {location || "/"}</div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/register" component={Register} />
      <Route path="/login" component={PlayerLogin} />
      <Route path="/lobby" component={Lobby} />
      <Route path="/tablegames" component={Lobby} />
      <Route path="/sportsbook" component={Lobby} />
      <Route path="/minigames" component={Lobby} />
      <Route path="/poker-tables" component={Lobby} />
      <Route path="/table/:tableId" component={TablePage} />
      <Route path="/poker" component={PokerLobby} />
      <Route path="/cases" component={CasesPage} />
      <Route path="/my-rewards" component={MyRewardsPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/blackjack" component={Blackjack} />
      <Route path="/slots" component={Lobby} />
      <Route path="/roulette" component={Roulette} />
      <Route path="/baccarat" component={Baccarat} />
      <Route path="/horse-racing" component={HorseRacing} />
      <Route path="/tournaments" component={Lobby} />
      <Route path="/tournaments-old" component={TournamentsListPage} />
      <Route path="/tournament/:id" component={TournamentPage} />
      <Route path="/slots-tournament/:id" component={SlotsTournamentPage} />
      <Route path="/mines" component={MinesPage} />
      <Route path="/keno" component={KenoPage} />
      <Route path="/high-low" component={HighLow} />
      <Route path="/slots-hub" component={SlotsHub} />
      <Route path="/rome-slots" component={RomeSlots} />
      <Route path="/western-slots" component={WesternSlots} />
      <Route path="/mob-tower" component={MobTower} />
      <Route path="/bingo" component={BingoPage} />
      <Route path="/lottery" component={Lobby} />
      <Route path="/mini-games" component={MiniGamesPage} />
      <Route path="/live-events" component={LiveEventsPage} />
      <Route path="/banker/login" component={BankerLogin} />
      <Route path="/banker" component={BankerDashboard} />
      <Route path="/page-preview/:key" component={PagePreview} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useVersionCheck();
  return (
    <QueryClientProvider client={queryClient}>
      <WsProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
          <GlobalDialogs />
          <ViewportDebug />
        </TooltipProvider>
      </WsProvider>
    </QueryClientProvider>
  );
}

export default App;
