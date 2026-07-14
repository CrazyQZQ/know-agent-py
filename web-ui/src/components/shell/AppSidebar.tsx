import { Bot, Database, LogOut, Moon, Network, Sun } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SessionList, type ShellSession } from "./SessionList";

type AppSidebarProps = { user: { name: string; roles: string[] }; sessions?: ShellSession[]; activeId?: string | null; onSelectSession?: (id: string) => void; onDeleteSession?: (id: string) => void; onLogout: () => void; onToggleTheme: () => void; mobileOpen?: boolean; onCloseMobile?: () => void };
const navItems = [{ to: "/assistant", label: "智能助理", icon: Bot }, { to: "/workflows", label: "工作流", icon: Network }, { to: "/knowledge", label: "知识库", icon: Database }];

export function AppSidebar({ user, sessions = [], activeId = null, onSelectSession = () => {}, onDeleteSession = () => {}, onLogout, onToggleTheme, mobileOpen = false, onCloseMobile }: AppSidebarProps) {
  return <aside className={`${mobileOpen ? "fixed inset-y-0 left-0 z-40 flex" : "hidden md:flex"} h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar`} aria-label="主导航">
    <div className="flex h-14 items-center justify-between px-4 text-base font-semibold">Know-Agent{onCloseMobile ? <button type="button" className="md:hidden" aria-label="关闭导航" onClick={onCloseMobile}>×</button> : null}</div>
    <nav className="space-y-1 px-2" aria-label="一级菜单">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm ${isActive ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}><Icon className="size-4" aria-hidden="true" />{label}</NavLink>)}</nav>
    <div className="mt-5 min-h-0 flex-1 overflow-y-auto border-t border-border px-2 pt-3"><h2 className="px-3 pb-2 text-xs font-medium text-muted-foreground">会话</h2><SessionList sessions={sessions} activeId={activeId} onSelect={onSelectSession} onDelete={onDeleteSession} /></div>
    <div className="border-t border-border p-3"><div className="mb-1 truncate px-2 text-sm font-medium" title={user.name}>{user.name}</div><div className="mb-2 truncate px-2 text-xs text-muted-foreground">{user.roles.length ? user.roles.join(" · ") : "公开用户"}</div><div className="flex items-center justify-between"><button type="button" title="切换主题" className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="切换主题" onClick={onToggleTheme}><Sun className="size-4 dark:hidden" aria-hidden="true" /><Moon className="hidden size-4 dark:block" aria-hidden="true" /></button><button type="button" title="退出登录" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="退出登录" onClick={onLogout}><LogOut className="size-4" aria-hidden="true" />退出</button></div></div>
  </aside>;
}
