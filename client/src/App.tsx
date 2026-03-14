import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Campaigns from "./pages/Campaigns";
import CampaignDetail from "./pages/CampaignDetail";
import Recipients from "./pages/Recipients";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import BotControl from "./pages/BotControl";
import Protection from "./pages/Protection";
import Scheduler from "./pages/Scheduler";
import Login from "./pages/Login";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/campaigns" component={Campaigns} />
      <Route path="/campaigns/:id" component={CampaignDetail} />
      <Route path="/campaigns/:id/recipients" component={Recipients} />
      <Route path="/logs" component={Logs} />
      <Route path="/settings" component={Settings} />
      <Route path="/bot-control" component={BotControl} />
      <Route path="/protection" component={Protection} />
      <Route path="/scheduler" component={Scheduler} />
      <Route path="/login" component={Login} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
