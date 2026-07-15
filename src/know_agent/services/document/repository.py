"""文档与分块数据访问 — 替代源项目 KnowledgeDocumentServiceImpl / KnowledgeSegmentServiceImpl."""

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from know_agent.models.document import KnowledgeDocument, KnowledgeSegment
from know_agent.models.enums import DocumentStatus, SegmentStatus


def _doc_accessible(accessible_by: str | None, roles: list[str] | None) -> bool:
    """文档对当前角色是否可访问.

    roles=None 表示不检查权限（内部处理：run_pipeline/split/embed/delete 直接取文档）。
    accessible_by 空=公开；否则当前角色与文档角色求交集。
    """
    if roles is None:
        return True  # 内部处理：不检查权限
    if not accessible_by:
        return True
    if not roles:
        return False
    doc_roles = [r.strip() for r in accessible_by.split(",") if r.strip()]
    return any(r in doc_roles for r in roles)


class DocumentRepository:
    def __init__(self, db: Session):
        self.db = db

    # ---- document ----
    def get_document(
        self, doc_id: int, roles: list[str] | None = None, current_user: str | None = None,
    ) -> KnowledgeDocument | None:
        doc = self.db.get(KnowledgeDocument, doc_id)
        if doc is None:
            return None
        # 权限：角色可见 OR 上传者本人（roles=None 表示内部处理，不检查）
        if not _doc_accessible(doc.accessible_by, roles) and doc.upload_user != current_user:
            return None  # 无权限视为不存在（404）
        return doc

    def save_document(self, document: KnowledgeDocument) -> KnowledgeDocument:
        self.db.add(document)
        self.db.commit()
        self.db.refresh(document)
        return document

    def update_document(self, document: KnowledgeDocument) -> None:
        self.db.commit()

    def list_documents_by_status(self, status: str) -> list[KnowledgeDocument]:
        try:
            doc_status = DocumentStatus(status)
        except ValueError:
            return []
        return list(self.db.scalars(
            select(KnowledgeDocument).where(KnowledgeDocument.status == doc_status)
        ))

    def page_documents(
        self, current: int = 1, size: int = 10,
        roles: list[str] | None = None, current_user: str | None = None,
    ) -> dict:
        stmt = select(KnowledgeDocument)
        count_stmt = select(func.count()).select_from(KnowledgeDocument)
        # 权限条件：公开 OR 角色重叠 OR 上传者本人
        conds = [
            KnowledgeDocument.accessible_by.is_(None),
            KnowledgeDocument.accessible_by == "",
        ]
        params: dict = {}
        if roles:
            arr_overlap = text("string_to_array(accessible_by, ',') && CAST(:roles AS text[])")
            conds.append(arr_overlap)
            params["roles"] = roles
        if current_user:
            conds.append(KnowledgeDocument.upload_user == current_user)
            params["current_user"] = current_user
        cond = or_(*conds)
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
        if params:
            stmt = stmt.params(**params)
            count_stmt = count_stmt.params(**params)
        total = self.db.scalar(count_stmt) or 0
        rows = list(self.db.scalars(
            stmt.order_by(KnowledgeDocument.doc_id.desc())
            .offset((current - 1) * size).limit(size)
        ))
        return {"records": rows, "total": total, "current": current, "size": size}

    def delete_document(self, doc_id: int) -> bool:
        document = self.get_document(doc_id)
        if document is None:
            return False
        self.db.delete(document)
        self.db.commit()
        return True

    # ---- segment ----
    def get_segment(self, seg_id: int) -> KnowledgeSegment | None:
        return self.db.get(KnowledgeSegment, seg_id)

    def get_segments_by_document(self, doc_id: int) -> list[KnowledgeSegment]:
        return list(self.db.scalars(
            select(KnowledgeSegment).where(KnowledgeSegment.document_id == doc_id)
            .order_by(KnowledgeSegment.chunk_order)
        ))

    def list_segments_by_status(self, status: str) -> list[KnowledgeSegment]:
        try:
            seg_status = SegmentStatus(status)
        except ValueError:
            return []
        return list(self.db.scalars(
            select(KnowledgeSegment).where(KnowledgeSegment.status == seg_status)
        ))

    def page_segments(self, current: int = 1, size: int = 10) -> dict:
        total = self.db.scalar(select(func.count()).select_from(KnowledgeSegment)) or 0
        rows = list(self.db.scalars(
            select(KnowledgeSegment).order_by(KnowledgeSegment.id.desc())
            .offset((current - 1) * size).limit(size)
        ))
        return {"records": rows, "total": total, "current": current, "size": size}

    def save_segments(self, segments: list[KnowledgeSegment]) -> None:
        self.db.add_all(segments)
        self.db.commit()

    def update_segment(self, segment: KnowledgeSegment) -> None:
        self.db.commit()

    def delete_segments_by_document(self, doc_id: int) -> None:
        self.db.query(KnowledgeSegment).filter(
            KnowledgeSegment.document_id == doc_id
        ).delete(synchronize_session=False)
        self.db.commit()

    def delete_segment(self, seg_id: int) -> bool:
        seg = self.get_segment(seg_id)
        if seg is None:
            return False
        self.db.delete(seg)
        self.db.commit()
        return True

    def get_pending_segments(self, doc_id: int) -> list[KnowledgeSegment]:
        """待向量化的分块：status=STORED & skip_embedding=0 & embedding_id is None."""
        return list(self.db.scalars(
            select(KnowledgeSegment).where(
                KnowledgeSegment.document_id == doc_id,
                KnowledgeSegment.status == SegmentStatus.STORED,
                KnowledgeSegment.skip_embedding == 0,
                KnowledgeSegment.embedding_id.is_(None),
            ).limit(100)
        ))

    def count_pending_segments(self, doc_id: int) -> int:
        return self.db.scalar(
            select(func.count()).select_from(KnowledgeSegment).where(
                KnowledgeSegment.document_id == doc_id,
                KnowledgeSegment.status == SegmentStatus.STORED,
                KnowledgeSegment.skip_embedding == 0,
                KnowledgeSegment.embedding_id.is_(None),
            )
        ) or 0

    def get_text_by_chunk_id(self, chunk_id: str) -> str | None:
        seg = self.db.scalar(
            select(KnowledgeSegment).where(KnowledgeSegment.chunk_id == chunk_id)
        )
        return seg.text if seg else None
