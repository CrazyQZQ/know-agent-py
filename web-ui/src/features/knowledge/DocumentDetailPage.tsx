import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Descriptions, Empty, List, Popconfirm, Tag } from "antd";
import { ArrowLeft, Trash2 } from "lucide-react";

import { useAuth } from "@/features/auth/AuthProvider";
import { useEnterAnimation } from "@/lib/gsap-animations";
import { formatDateTime } from "@/lib/format";
import { MarkdownText } from "@/components/MarkdownText";
import { DOCUMENT_STATUS, deleteDocument, getDocument, listSegmentsByDocument, type DocumentDetail, type SegmentRow } from "./knowledge-api";

export function DocumentDetailPage() {
  const { auth } = useAuth();
  const { documentId } = useParams();
  const navigate = useNavigate();
  const sectionRef = useEnterAnimation<HTMLElement>();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);

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
          pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
          renderItem={(seg, index) => (
            <List.Item className="block!">
              <Card size="small">
                <div className="mb-2 text-xs font-medium text-muted-foreground">#{index + 1}</div>
                <div className="markdown-content text-sm"><MarkdownText>{seg.text}</MarkdownText></div>
              </Card>
            </List.Item>
          )}
        />
      )}
    </section>
  );
}
