import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";

import { AppSidebar } from "./AppSidebar";

type AppShellProps = {
  user: { name: string; roles: string[] };
  token?: string;
  children: ReactNode;
  onLogout: () => void;
  onToggleTheme: () => void;
};

export function AppShell({ user, token, children, onLogout, onToggleTheme }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div data-testid="app-shell" className="flex h-dvh min-h-0 overflow-hidden bg-background">
    <button type="button" className="fixed left-3 top-3 z-30 rounded-lg border border-border/60 bg-background/90 p-2 shadow-sm backdrop-blur md:hidden" aria-label="打开导航" onClick={() => setMobileOpen(true)}><Menu className="size-4" /></button>
    <AppSidebar user={user} token={token} onLogout={onLogout} onToggleTheme={onToggleTheme} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
    <main className="min-w-0 flex-1 overflow-auto">{children}</main>
  </div>;
}
