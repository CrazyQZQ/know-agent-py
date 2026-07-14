import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import type { ShellSession } from "./SessionList";
type AppShellProps = { user: { name: string; roles: string[] }; children: ReactNode; sessions?: ShellSession[]; activeId?: string | null; onSelectSession?: (id: string) => void; onDeleteSession?: (id: string) => void; onLogout: () => void; onToggleTheme: () => void };
export function AppShell({ user, children, ...sidebarProps }: AppShellProps) { const [mobileOpen, setMobileOpen] = useState(false); return <div data-testid="app-shell" className="flex h-dvh min-h-0 overflow-hidden bg-background"><button type="button" className="fixed left-3 top-3 z-30 rounded-md border bg-background p-2 md:hidden" aria-label="打开导航" onClick={() => setMobileOpen(true)}><Menu className="size-4" /></button><AppSidebar user={user} {...sidebarProps} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} /><main className="min-w-0 flex-1 overflow-auto">{children}</main></div>; }
