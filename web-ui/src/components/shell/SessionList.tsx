import { LoaderCircle, Trash2 } from "lucide-react";

export type ShellSession = { id: string; title: string; running?: boolean };
type SessionListProps = { sessions: ShellSession[]; activeId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void };

export function SessionList({ sessions, activeId, onSelect, onDelete }: SessionListProps) {
  if (sessions.length === 0) return <p className="px-3 py-4 text-xs text-muted-foreground">暂无会话</p>;
  return <div className="space-y-0.5" aria-label="会话列表">{sessions.map((session) => <div key={session.id} className={`group flex items-center gap-1 rounded-[12px] transition-colors ${activeId === session.id ? "bg-sidebar-accent shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border)/0.45)]" : "hover:bg-sidebar-accent/70"}`}>
    <button type="button" className="flex h-8 min-w-0 flex-1 items-center gap-2 truncate px-3 text-left text-[12.5px]" onClick={() => onSelect(session.id)} aria-current={activeId === session.id ? "page" : undefined}>
      {session.running ? <LoaderCircle aria-label={`${session.title}正在运行`} className="h-3.5 w-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" /> : <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}<span className="truncate">{session.title}</span>
    </button>
    <button type="button" className="mr-1 rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100" aria-label={`删除${session.title}`} onClick={() => onDelete(session.id)}><Trash2 className="h-3.5 w-3.5" /></button>
  </div>)}</div>;
}
