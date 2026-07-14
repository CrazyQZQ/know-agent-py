import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import type { ShellSession } from "./SessionList";
type AppShellProps = { user: { name: string; roles: string[] }; children: ReactNode; sessions?: ShellSession[]; activeId?: string | null; onSelectSession?: (id: string) => void; onDeleteSession?: (id: string) => void; onLogout: () => void; onToggleTheme: () => void };
export function AppShell({ user, children, ...sidebarProps }: AppShellProps) { return <div className="flex h-full min-h-0 bg-background"><AppSidebar user={user} {...sidebarProps} /><main className="min-w-0 flex-1 overflow-auto">{children}</main></div>; }
