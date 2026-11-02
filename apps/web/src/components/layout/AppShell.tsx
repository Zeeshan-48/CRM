import * as React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { CommandPalette } from "@/components/command/CommandPalette";
import { CopilotDrawer } from "@/components/copilot/CopilotDrawer";
import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { useAuthStore } from "@/stores/auth-store";

interface ShellContextValue {
  openCopilot: () => void;
  openPalette: () => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

/**
 * Access shell-level actions (Copilot drawer, command palette) from any page
 * rendered inside the AppShell.
 */
export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within AppShell");
  return ctx;
}

export default function AppShell() {
  const token = useAuthStore((s) => s.token);
  const [copilotOpen, setCopilotOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === "j") {
        event.preventDefault();
        setCopilotOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const shell = React.useMemo<ShellContextValue>(
    () => ({
      openCopilot: () => setCopilotOpen(true),
      openPalette: () => setPaletteOpen(true),
    }),
    [],
  );

  // No session on a protected route → login. (Guests hitting "/" get the
  // marketing landing via the public RootRoute instead.)
  if (!token) return <Navigate to="/login" replace />;

  return (
    <ShellContext.Provider value={shell}>
      <div className="min-h-screen bg-background">
        <TopBar />
        <div className="flex">
          <SideNav />
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1200px]">
              <Outlet />
            </div>
          </main>
        </div>

        <OnboardingChecklist />
        <CopilotDrawer open={copilotOpen} onOpenChange={setCopilotOpen} />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onAskCopilot={() => {
            setPaletteOpen(false);
            setCopilotOpen(true);
          }}
        />
      </div>
    </ShellContext.Provider>
  );
}
