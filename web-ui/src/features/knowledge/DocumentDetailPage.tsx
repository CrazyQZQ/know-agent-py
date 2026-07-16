import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Descriptions, Empty, List, Popconfirm, Tag } from "antd";
import { ArrowLeft, Check, Copy, Trash2 } from "lucide-react";

import { useAuth } from "@/features/auth/AuthProvider";
import { useEnterAnimation } from "@/lib/gsap-animations";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { MarkdownText } from "@/components/MarkdownText";
import { DOCUMENT_STATUS, deleteDocument, getDocument, listSegmentsByDocument, type DocumentDetail, type SegmentRow } from "./knowledge-api";

const SEGMENT_PAGE_SIZE = 8;

export function DocumentDetailPage() {
  const { auth } = useAuth();
  const { documentId } = useParams();
  const navigate = useNavigate();
  const sectionRef = useEnterAnimation<HTMLElement>();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    if (!documentId) return;
    const id = Number(documentId);
    setLoading(true);
    Promise.all([
      getDocument(auth?.token ?? "", id),
      listSegmentsByDocument(auth?.token ?? "", id),
    ]).then(([d, segs]) => {
      setDoc(d);
      setSegments(segs ?? []);
    }).finally(() => setLoading(false));
  }, [auth?.token, documentId]);

  async function remove() {
    await deleteDocument(auth?.token ?? "", Number(documentId));
    navigate("/knowledge");
  }

  async function copySegment(seg: SegmentRow) {
    if (!(await copyTextToClipboard(seg.text))) return;
    setCopiedId(seg.id);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1_500);
  }

  return (
    <section ref={sectionRef} className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Button type="text" shape="circle" aria-label="返回" onClick={() => navigate("/knowledge")} icon={<ArrowLeft className="h-4 w-4" />} />
        <h1 className="text-xl font-semibold">{doc?.doc_title ?? "文档详情"}</h1>
        <Popconfirm title="确认删除该文档？" description="删除后无法恢复" onConfirm={() => void remove()} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button danger type="text" shape="circle" aria-label="删除文档" icon={<Trash2 className="h-4 w-4" />} className="ml-auto" />
        </Popconfirm>
      </div>

      <Descriptions bordered column={2} size="small">
        <Descriptions.Item label="状态">{doc ? <Tag color={DOCUMENT_STATUS[doc.status]?.color ?? "blue"}>{DOCUMENT_STATUS[doc.status]?.label ?? doc.status}</Tag> : "-"}</Descriptions.Item>
        <Descriptions.Item label="知识库类型">{doc?.knowledge_base_type ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="上传人">{doc?.upload_user ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{doc ? formatDateTime(doc.updated_at) : "-"}</Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>{doc?.description || "-"}</Descriptions.Item>
      </Descriptions>

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="text-base font-medium">分段内容</h2>
        <span className="text-xs text-muted-foreground">共 {segments.length} 段</span>
      </div>
      {loading ? <Empty description="加载中..." /> : segments.length === 0 ? <Empty description="暂无分段" /> : (
        <List
          dataSource={segments}
          split={false}
          pagination={{ pageSize: SEGMENT_PAGE_SIZE, size: "small", showSizeChanger: false }}
          renderItem={(seg, index) => (
            <List.Item className="border-0! px-0! py-1.5!">
              <div className="group w-full rounded-lg border border-border/60 bg-card p-4 transition-all hover:border-primary/30 hover:shadow-md">
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">{index + 1}</span>
                  <span className="text-xs text-muted-foreground">{seg.text.length} 字</span>
                  <Button type="text" size="small" className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" aria-label={`复制分段 ${index + 1}`} onClick={() => void copySegment(seg)} icon={copiedId === seg.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} />
                </div>
                <div className="markdown-content text-sm leading-6"><MarkdownText>{seg.text}</MarkdownText></div>
              </div>
            </List.Item>
          )}
        />
      )}
    </section>
  );
}
