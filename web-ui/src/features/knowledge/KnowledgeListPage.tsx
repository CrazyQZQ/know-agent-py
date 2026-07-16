import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Select } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatDateTime } from "@/lib/format";
import { DocumentUploadDialog } from "./DocumentUploadDialog";
import { deleteDocument, listAllDocuments, type DocumentRow } from "./knowledge-api";

const STATUS: Record<string, string> = {
  UPLOADED: "text-slate-600 bg-slate-100",
  CONVERTING: "text-amber-700 bg-amber-100",
  CONVERTED: "text-blue-700 bg-blue-100",
  CHUNKED: "text-cyan-700 bg-cyan-100",
  VECTOR_STORED: "text-emerald-700 bg-emerald-100",
};

export function KnowledgeListPage() {
  const { auth } = useAuth();
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const size = 10;
  const load = useCallback(async () => setRows(await listAllDocuments(auth?.token ?? "")), [auth?.token]);
  useEffect(() => { void load(); }, [load]);
  const remove = async (id: number) => { await deleteDocument(auth?.token ?? "", id); setRows((prev) => prev.filter((row) => row.id !== id)); };
  const filtered = rows.filter((row) => (!query || row.title.toLowerCase().includes(query.toLowerCase())) && (filter === "all" || row.knowledge_base_type === filter));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const visible = filtered.slice((page - 1) * size, page * size);

  return <>
    <DocumentUploadDialog open={uploadOpen} onClose={() => { setUploadOpen(false); void load(); }} />
    <section className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">知识库</h1>
        <div className="relative w-64 shrink-0">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input aria-label="搜索文档" role="searchbox" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} className="h-9 w-full rounded-md border pl-8 pr-2 text-sm" placeholder="搜索文档" />
        </div>
        <Select aria-label="知识库类型" value={filter} onChange={(value) => { setPage(1); setFilter(value); }} className="w-36" placeholder="全部类型">
          <Select.Option value="all">全部类型</Select.Option>
          <Select.Option value="qa">问答库</Select.Option>
          <Select.Option value="data">数据查询</Select.Option>
        </Select>
        <button type="button" aria-label="刷新" onClick={() => void load()} className="rounded-md border p-2 transition-colors hover:bg-muted"><RefreshCw className="h-4 w-4" /></button>
        <button type="button" onClick={() => setUploadOpen(true)} className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90">上传文档</button>
      </div>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">文档</th><th className="p-2">状态</th><th className="p-2">更新时间</th><th className="p-2">操作</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id} className="border-b transition-colors hover:bg-muted/35"><td className="p-2">{row.title}</td><td className="p-2"><span className={`rounded px-2 py-1 text-xs ${STATUS[row.status] ?? STATUS.UPLOADED}`}>{row.status}</span></td><td className="p-2">{formatDateTime(row.updated_at)}</td><td className="flex gap-2 p-2"><Link aria-label="查看详情" className="text-primary" to={`/knowledge/${row.id}`}>查看详情</Link><button type="button" aria-label="删除" className="text-destructive" onClick={() => void remove(row.id)}>删除</button></td></tr>)}</tbody>
      </table>
      <div className="mt-4 flex items-center justify-end gap-2 text-sm"><span>共 {total} 条 · 第 {page}/{pages} 页</span><button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-2 py-1 transition-colors hover:bg-muted disabled:opacity-40">上一页</button><button type="button" aria-label="下一页" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded border px-2 py-1 transition-colors hover:bg-muted disabled:opacity-40">下一页</button></div>
    </section>
  </>;
}
