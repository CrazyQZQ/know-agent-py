import { LoaderCircle, Trash2 } from "lucide-react";

export type ShellSession = { id: string; title: string; running?: boolean };
type SessionListProps = { sessions: ShellSession[]; activeId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void };

export function SessionList({ sessions, activeId, onSelect, onDelete }: SessionListProps) {
  if (sessions.length === 0) return <p className="px-3 py-4 text-sm text-muted-foreground">暂无会话</p>;
  return <div className="space-y-1" aria-label="会话列表">{sessions.map((session) => <div key={session.id} className={`group flex items-center gap-1 rounded-md ${activeId === session.id ? "bg-accent" : ""}`}>
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => onSelect(session.id)} aria-current={activeId === session.id ? "page" : undefined}>
      {session.running ? <LoaderCircle aria-label={`${session.title}正在运行`} className="size-4 shrink-0 animate-spin text-primary" /> : <span className="size-4 shrink-0" aria-hidden="true" />}<span className="truncate">{session.title}</span>
    </button>
    <button type="button" className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" aria-label={`删除${session.title}`} onClick={() => onDelete(session.id)}><Trash2 className="size-3.5" aria-hidden="true" /></button>
  </div>)}</div>;
}
