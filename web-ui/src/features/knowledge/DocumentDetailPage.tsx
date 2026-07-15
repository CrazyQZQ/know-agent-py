import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type DocumentSegment = {
  id?: string | number;
  content?: string;
};

type DocumentDetail = {
  title?: string;
  status?: string;
  updated_at?: string | number | null;
  segments?: DocumentSegment[];
};

export function DocumentDetailPage() {
  const { auth } = useAuth();
  const { documentId } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  useEffect(() => {
    if (documentId)
      void apiRequest<DocumentDetail>(`/v1/api/document/${documentId}`, {
        token: auth?.token,
      }).then(setDoc);
  }, [auth?.token, documentId]);
  const remove = async () => {
    await apiRequest(`/v1/api/document/${documentId}`, {
      method: "DELETE",
      token: auth?.token,
    });
    navigate("/knowledge");
  };
  return (
    <section className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/knowledge">返回</Link>
        <h1 className="text-2xl font-semibold">文档详情</h1>
        <button
          type="button"
          className="ml-auto text-destructive"
          onClick={() => void remove()}
        >
          删除
        </button>
      </div>
      {doc ? (
        <>
          <dl className="grid grid-cols-2 gap-3 rounded border p-4 text-sm">
            <dt>标题</dt>
            <dd>{doc.title}</dd>
            <dt>状态</dt>
            <dd>{doc.status}</dd>
            <dt>更新时间</dt>
            <dd>{formatDateTime(doc.updated_at)}</dd>
          </dl>
          <h2 className="mt-5 font-medium">分段</h2>
          <ol className="mt-2 space-y-2">
            {(doc.segments ?? []).map((segment, i) => (
              <li key={segment.id ?? i} className="rounded border p-3 text-sm">
                {segment.content}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p>加载中</p>
      )}
    </section>
  );
}
