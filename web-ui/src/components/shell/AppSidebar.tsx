import { useCallback, useEffect, useState } from "react";
import { Button } from "antd";
import { Bot, Database, LogOut, Moon, Network, SquarePen, Sun, X } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import {
  createAssistantSession,
  deleteAssistantSession,
  listAssistantSessions,
  type AssistantSession,
} from "@/features/assistant/assistant-api";
import { SessionList } from "./SessionList";

type AppSidebarProps = {
  user: { name: string; roles: string[] };
  token?: string;
  onLogout: () => void;
  onToggleTheme: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

const navItems = [
  { to: "/assistant", label: "智能助理", icon: Bot },
  { to: "/workflows", label: "工作流", icon: Network },
  { to: "/knowledge", label: "知识库", icon: Database },
];

export function AppSidebar({ user, token = "", onLogout, onToggleTheme, mobileOpen = false, onCloseMobile }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [loading, setLoading] = useState(false);
  const isAssistant = location.pathname.startsWith("/assistant");
  const activeId = isAssistant ? location.pathname.split("/")[2] ?? null : null;

  const loadSessions = useCallback(async () => {
    if (!isAssistant || !token) return;
    setLoading(true);
    try { setSessions(await listAssistantSessions(user.name, token)); }
    finally { setLoading(false); }
  }, [isAssistant, token, user.name]);

  useEffect(() => { void loadSessions(); }, [activeId, loadSessions]);

  async function newConversation() {
    const created = await createAssistantSession(user.name, token);
    setSessions((current) => [{ thread_id: created.thread_id, name: "新对话" }, ...current.filter((item) => item.thread_id !== created.thread_id)]);
    navigate(`/assistant/${created.thread_id}`);
    onCloseMobile?.();
  }

  async function removeConversation(id: string) {
    await deleteAssistantSession(user.name, id, token);
    setSessions((current) => current.filter((item) => item.thread_id !== id));
    if (activeId === id) navigate("/assistant");
  }

  return (
    <aside className={`${mobileOpen ? "fixed inset-y-0 left-0 z-40 flex" : "hidden md:flex"} h-full w-[17rem] shrink-0 flex-col border-r border-sidebar-border/60 bg-sidebar text-sidebar-foreground`} aria-label="主导航">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="text-[15px] font-semibold">Know-Agent</span>
        {onCloseMobile ? <Button type="text" className="ml-auto h-7 w-7 rounded-lg md:hidden" aria-label="关闭导航" onClick={onCloseMobile}><X className="h-3.5 w-3.5" /></Button> : null}
      </div>

      <nav className="space-y-1 px-2" aria-label="一级菜单">
        {navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={onCloseMobile} className={({ isActive }) => `flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] font-medium transition-colors ${isActive ? "bg-sidebar-accent text-sidebar-foreground shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border)/0.55)]" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/75 hover:text-sidebar-foreground"}`}><Icon className="h-4 w-4" />{label}</NavLink>)}
      </nav>

      {isAssistant ? <div className="mt-4 min-h-0 flex-1 border-t border-sidebar-border/50 px-2 pt-3">
        <Button type="text" className="mb-2 h-8 w-full justify-start gap-2 rounded-full px-3 text-[12.5px] font-medium" onClick={() => void newConversation()} disabled={loading || !token}><SquarePen className="h-4 w-4" />新建对话</Button>
        <div className="flex h-[calc(100%-2.5rem)] min-h-0 flex-col">
          <h2 className="px-3 pb-2 text-[11px] font-medium text-muted-foreground">会话</h2>
          <div className="min-h-0 flex-1 overflow-y-auto"><SessionList sessions={sessions.map((item) => ({ id: item.thread_id, title: item.name || "未命名对话" }))} activeId={activeId} onSelect={(id) => { navigate(`/assistant/${id}`); onCloseMobile?.(); }} onDelete={(id) => void removeConversation(id)} /></div>
        </div>
      </div> : <div className="flex-1" />}

      <div className="border-t border-sidebar-border/50 p-3">
        <div className="mb-3 px-2"><div className="truncate text-sm font-medium" title={user.name}>{user.name}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{user.roles.length ? user.roles.join(" · ") : "公开用户"}</div></div>
        <div className="flex items-center justify-between">
          <Button type="text" title="切换主题" className="h-8 w-8 rounded-lg" aria-label="切换主题" onClick={onToggleTheme}><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></Button>
          <Button type="text" title="退出登录" className="h-8 gap-2 rounded-full px-3 text-xs" aria-label="退出登录" onClick={onLogout}><LogOut className="h-4 w-4" />退出</Button>
        </div>
      </div>
    </aside>
  );
}
