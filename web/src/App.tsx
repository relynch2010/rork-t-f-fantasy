import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { SplashScreen } from "@/components/td";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import Home from "./pages/Home";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Activity, { Alerts } from "./pages/league/Activity";
import Commish from "./pages/league/Commish";
import Admin from "./pages/league/Admin";
import Draft from "./pages/league/Draft";
import GlobalSettings from "./pages/league/GlobalSettings";
import LeagueLayout from "./pages/league/LeagueLayout";
import MatchupPage from "./pages/league/MatchupPage";
import Meets from "./pages/league/Meets";
import Mocks from "./pages/league/Mocks";
import Overview from "./pages/league/Overview";
import Players from "./pages/league/Players";
import SettingsPage from "./pages/league/SettingsPage";
import { Playoffs, Scoreboard, Standings } from "./pages/league/Tables";
import TeamPage from "./pages/league/TeamPage";
import Waivers from "./pages/league/Waivers";
import Lab from "./pages/league/Lab";
import Integrity from "./pages/league/Integrity";
import Schedule from "./pages/league/Schedule";
import ScoringLab from "./pages/league/ScoringLab";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true } } });

function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return <SplashScreen />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/league/:id" element={<LeagueLayout />}>
        <Route index element={<Overview />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="team/:teamId" element={<TeamPage />} />
        <Route path="matchup" element={<MatchupPage />} />
        <Route path="scoreboard" element={<Scoreboard />} />
        <Route path="standings" element={<Standings />} />
        <Route path="players" element={<Players />} />
        <Route path="draft" element={<Draft />} />
        <Route path="mocks" element={<Mocks />} />
        <Route path="activity" element={<Activity />} />
        <Route path="waivers" element={<Waivers />} />
        <Route path="lab" element={<Lab />} />
        <Route path="integrity" element={<Integrity />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="scoring-lab" element={<ScoringLab />} />
        <Route path="playoffs" element={<Playoffs />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="meets" element={<Meets />} />
        <Route path="global" element={<GlobalSettings />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="commish" element={<Commish />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster theme="dark" position="top-center" richColors />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
