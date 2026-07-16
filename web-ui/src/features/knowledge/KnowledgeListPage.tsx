import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Select, Tag } from "antd";
import { ChevronLeft, ChevronRight, Eye, RefreshCw, Search, Trash2, Upload } from "lucide-react";

import { useAuth } from "@/features/auth/AuthProvider";
import { useEnterAnimation } from "@/lib/gsap-animations";
import { formatDateTime } from "@/lib/format";
import { DocumentUploadDialog } from "./DocumentUploadDialog";
import { DOCUMENT_STATUS, deleteDocument, listAllDocuments, type DocumentRow } from "./knowledge-api";

export function KnowledgeListPage() {
  const { auth } = useAuth();
  const sectionRef = useEnterAnimation<HTMLElement>();
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
    <section ref={sectionRef} className="p-5">
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
        <Button type="text" shape="circle" aria-label="刷新" onClick={() => void load()} icon={<RefreshCw className="h-4 w-4" />} />
        <Button type="primary" aria-label="上传文档" onClick={() => setUploadOpen(true)} icon={<Upload className="h-4 w-4" />} />
      </div>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">文档</th><th className="p-2">状态</th><th className="p-2">更新时间</th><th className="p-2 text-center">操作</th></tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id} className="border-b transition-colors hover:bg-muted/35"><td className="p-2">{row.title}</td><td className="p-2"><Tag color={DOCUMENT_STATUS[row.status]?.color ?? "blue"}>{DOCUMENT_STATUS[row.status]?.label ?? row.status}</Tag></td><td className="p-2">{formatDateTime(row.updated_at)}</td><td className="flex gap-1 justify-center p-2"><Link aria-label="查看详情" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-primary hover:bg-muted" to={`/knowledge/${row.id}`}><Eye className="h-4 w-4" /></Link><Button type="text" danger shape="circle" size="small" aria-label="删除" onClick={() => void remove(row.id)} icon={<Trash2 className="h-4 w-4" />} /></td></tr>)}</tbody>
      </table>
      <div className="mt-4 flex items-center justify-end gap-2 text-sm"><span>共 {total} 条 · 第 {page}/{pages} 页</span><Button shape="circle" size="small" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} icon={<ChevronLeft className="h-4 w-4" />} /><Button shape="circle" size="small" aria-label="下一页" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} icon={<ChevronRight className="h-4 w-4" />} /></div>
    </section>
  </>;
}
