"""文档管理路由 — 对应源项目 KnowledgeDocumentController + KnowledgeSegmentController."""

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from know_agent.configuration import get_settings
from know_agent.core.deps import get_db
from know_agent.core.request_context import get_current_roles
from know_agent.models.enums import DocumentStatus
from know_agent.schemas.document import DocumentOut, PageResponse, SearchResultOut, SegmentOut
from know_agent.services.document.repository import DocumentRepository
from know_agent.services.document.search import SearchService
from know_agent.services.document.service import DocumentProcessService, UploadParams, run_document_pipeline
from know_agent.services.document.splitter import SplitParams

router = APIRouter()
segment_router = APIRouter()


# ===== 文档 =====

@router.post("/upload", response_model=DocumentOut)
async def upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    upload_user: str = Form(...),
    title: str = Form(...),
    description: str = Form(...),
    knowledge_base_type: str = Form(...),
    accessible_by: str | None = Form(None),
    table_name: str | None = Form(None),
    db: Session = Depends(get_db),
) -> DocumentOut:
    content = await file.read()
    # 上传安全：大小 + 扩展名白名单校验
    s = get_settings()
    if len(content) > s.upload_max_size_mb * 1024 * 1024:
        raise HTTPException(413, f"文件超过 {s.upload_max_size_mb}MB 限制")
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else ""
    allowed = {e.strip().lower() for e in s.upload_allowed_extensions.split(",") if e.strip()}
    if ext not in allowed:
        raise HTTPException(415, f"不支持的文件类型: .{ext or '?'}, 允许: {sorted(allowed)}")
    params = UploadParams(
        upload_user=upload_user,
        title=title,
        accessible_by=accessible_by,
        description=description,
        knowledge_base_type=knowledge_base_type,
        table_name=table_name,
    )
    doc = DocumentProcessService(db).upload(file.filename or "file", content, params)
    # 注册后台全链路处理（解析 → 分块 → 向量化），upload 立即返回 UPLOADED，前端轮询状态
    background_tasks.add_task(run_document_pipeline, doc.doc_id)
    return DocumentOut.model_validate(doc)


@router.post("/split/{document_id}")
def split(
    document_id: int,
    split_type: str = Form("SMART"),
    chunk_size: int = Form(500),
    overlap: int = Form(0),
    regex: str | None = Form(None),
    separator: str | None = Form(None),
    title_level: int | None = Form(None),
    db: Session = Depends(get_db),
) -> int:
    params = SplitParams(
        split_type=split_type,
        chunk_size=chunk_size,
        overlap=overlap,
        regex=regex,
        separator=separator,
    )
    return DocumentProcessService(db).split(document_id, params)


@router.post("/embedding/{doc_id}")
def embedding(doc_id: int, db: Session = Depends(get_db)) -> str:
    return "success" if DocumentProcessService(db).embed_and_store(doc_id) else "failed"


@router.get("/page", response_model=PageResponse[DocumentOut])
def page(
    current: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    return DocumentRepository(db).page_documents(current, size, roles=get_current_roles())


@router.get("/list-by-status", response_model=list[DocumentOut])
def list_by_status(status: str, db: Session = Depends(get_db)) -> list:
    return DocumentRepository(db).list_documents_by_status(status)


@router.get("/search", response_model=list[SearchResultOut])
def search(
    q: str = Query(..., description="检索关键词/问句"),
    top_k: int = Query(10, ge=1, le=50),
    mode: str = Query("hybrid", pattern="^(keyword|vector|hybrid)$"),
    knowledge_base_type: str | None = Query(None, description="知识库类型，按类型隔离向量检索"),
    document_id: int | None = Query(None, description="按文档 ID 过滤"),
    file_name: str | None = Query(None, description="按文件名过滤"),
    db: Session = Depends(get_db),
) -> list:
    """混合检索：keyword(pg_trgm) / vector(pgvector) / hybrid(RRF 融合). 按 accessible_by 角色过滤."""
    svc = SearchService(db)
    roles = get_current_roles()
    # 构建 metadata 过滤条件（document_id 用列，其他用 metadata->>'key'）
    search_filter: dict = {}
    if document_id is not None:
        search_filter["document_id"] = document_id
    if file_name:
        search_filter["fileName"] = file_name
    search_filter = search_filter or None
    if mode == "keyword":
        results = svc.keyword_search(q, top_k=top_k, roles=roles, filter=search_filter)
    elif mode == "vector":
        results = svc.vector_search(q, top_k=top_k, roles=roles,
                                    knowledge_base_type=knowledge_base_type, filter=search_filter)
    else:
        results = svc.hybrid_search(q, top_k=top_k, roles=roles,
                                    knowledge_base_type=knowledge_base_type, filter=search_filter)
    return [
        SearchResultOut(
            segment_id=r.segment_id, text=r.text, score=r.score,
            source=r.source, metadata=r.metadata,
        )
        for r in results
    ]


@router.get("/roles", tags=["document"])
def list_roles_endpoint() -> list[dict]:
    """列出 Casdoor 可选角色（上传文档时绑定可见角色用）."""
    from know_agent.core.casdoor import list_roles

    return list_roles()


@router.get("/{doc_id}", response_model=DocumentOut)
def get_doc(doc_id: int, db: Session = Depends(get_db)) -> DocumentOut:
    doc = DocumentRepository(db).get_document(doc_id, roles=get_current_roles())
    if doc is None:
        raise HTTPException(404, "document not found")
    return DocumentOut.model_validate(doc)


@router.delete("/{doc_id}")
def delete_doc(doc_id: int, db: Session = Depends(get_db)) -> bool:
    return DocumentProcessService(db).delete_document(doc_id)


# ===== 分块 =====

@segment_router.get("/page", response_model=PageResponse[SegmentOut])
def seg_page(
    current: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    return DocumentRepository(db).page_segments(current, size)


@segment_router.get("/list-by-document", response_model=list[SegmentOut])
def seg_list_by_document(document_id: int, db: Session = Depends(get_db)) -> list:
    return DocumentRepository(db).get_segments_by_document(document_id)


@segment_router.get("/list-by-status", response_model=list[SegmentOut])
def seg_list_by_status(status: str, db: Session = Depends(get_db)) -> list:
    return DocumentRepository(db).list_segments_by_status(status)


@segment_router.get("/{seg_id}", response_model=SegmentOut)
def seg_get(seg_id: int, db: Session = Depends(get_db)) -> SegmentOut:
    seg = DocumentRepository(db).get_segment(seg_id)
    if seg is None:
        raise HTTPException(404, "segment not found")
    return SegmentOut.model_validate(seg)


@segment_router.delete("/{seg_id}")
def seg_delete(seg_id: int, db: Session = Depends(get_db)) -> bool:
    return DocumentRepository(db).delete_segment(seg_id)
