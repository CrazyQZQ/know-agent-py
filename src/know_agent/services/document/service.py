"""文档处理服务 — 状态机：upload → process → split → embed.

对应源项目 DocumentProcessServiceImpl + MinerUProcessBaseServiceImpl（processDocument 部分）。
upload 仅入库 + OSS 上传即返回；解析/分块/向量化由 BackgroundTasks 异步执行
（run_document_pipeline，独立 session），前端轮询 GET /{doc_id} 看 status 流转。

split 后分块入 PG（业务）；embed 时入 pgvector（向量）。
关键词检索使用 PG 内置 pg_trgm（见 services/document/search.py），无需额外入库。
混合检索 = pg_trgm 关键词 + pgvector 向量 + RRF 融合。
"""

import hashlib
from dataclasses import dataclass

from langchain_core.documents import Document
from loguru import logger
from sqlalchemy.orm import Session

from know_agent.configuration import get_settings
from know_agent.models.document import KnowledgeDocument, KnowledgeSegment
from know_agent.models.enums import DocumentStatus, FileType, KnowledgeBaseType, SegmentStatus
from know_agent.services.document.processors.factory import get_file_type, get_processor
from know_agent.services.document.repository import DocumentRepository
from know_agent.services.document.splitter import (
    DocumentChunk,
    MetadataKey,
    SplitParams,
    split,
    split_excel,
)
from know_agent.services.document.vectorstore import collection_for, get_vectorstore
from know_agent.services.oss import get_oss


@dataclass
class UploadParams:
    upload_user: str
    title: str
    accessible_by: str | None = None
    description: str | None = None
    knowledge_base_type: str = "DOCUMENT_SEARCH"
    table_name: str | None = None


class DocumentProcessService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = DocumentRepository(db)

    # ---------- upload ----------
    def upload(self, file_name: str, content: bytes, params: UploadParams) -> KnowledgeDocument:
        oss = get_oss()
        doc_url = oss.upload_bytes(content, object_name=file_name)
        # 规范化 accessible_by：trim + 去空，存为逗号分隔的角色列表
        accessible_by_norm = ",".join(
            r.strip() for r in (params.accessible_by or "").split(",") if r.strip()
        ) or None
        document = KnowledgeDocument(
            doc_title=params.title,
            upload_user=params.upload_user,
            doc_url=doc_url,
            status=DocumentStatus.UPLOADED,
            accessible_by=accessible_by_norm,
            description=params.description,
            knowledge_base_type=KnowledgeBaseType(params.knowledge_base_type),
        )
        if params.table_name:
            document.extension = {"tableName": params.table_name, "isOverride": False}
        self.repo.save_document(document)
        # 解析/分块/向量化由后台任务异步执行（见 run_document_pipeline），upload 立即返回
        return document

    def _process_document(self, document: KnowledgeDocument, content: bytes, file_name: str) -> None:
        file_type = get_file_type(file_name)
        if file_type is None:
            logger.warning("unsupported file type: {}", file_name)
            return
        processor = get_processor(file_type, document.knowledge_base_type)
        if processor is None:
            # Excel/CSV/TXT/MD：converted = 原始
            document.converted_doc_url = document.doc_url
            document.status = (
                DocumentStatus.CONVERTED
                if document.knowledge_base_type == KnowledgeBaseType.DOCUMENT_SEARCH
                else DocumentStatus.STORED
            )
            self.repo.update_document(document)
            return
        # PDF/Word：解析为 markdown/text
        try:
            document.status = DocumentStatus.CONVERTING
            self.repo.update_document(document)
            text = processor.parse(content)
            object_name = f"converted/{_strip_ext(file_name)}.md"
            converted_url = get_oss().upload_bytes(
                text.encode("utf-8"), object_name, "text/markdown"
            )
            document.converted_doc_url = converted_url
            document.status = DocumentStatus.CONVERTED
            self.repo.update_document(document)
        except Exception as e:
            logger.exception("document parse failed: {}", file_name)
            document.status = DocumentStatus.UPLOADED
            self.repo.update_document(document)
            raise

    # ---------- split（增量：MD5 对比，复用未变更分块的 embedding）----------
    def split(self, doc_id: int, params: SplitParams) -> int:
        document = self.repo.get_document(doc_id)
        if document is None:
            raise ValueError(f"document {doc_id} not found")
        if not document.converted_doc_url:
            raise ValueError("document has not been converted")
        if document.status not in (DocumentStatus.CONVERTED, DocumentStatus.CHUNKED, DocumentStatus.VECTOR_STORED):
            raise ValueError(f"document status must be CONVERTED/CHUNKED/VECTOR_STORED, got {document.status}")

        chunks, content_md5 = self._read_and_split(document, params)
        old_segments = self.repo.get_segments_by_document(doc_id)
        total = self._incremental_split(document, chunks, old_segments)
        document.status = DocumentStatus.CHUNKED
        document.content_md5 = content_md5  # 更新文档内容版本
        self.repo.update_document(document)
        logger.info("document {} split: {} segments", doc_id, total)
        return total

    def _read_and_split(
        self, document: KnowledgeDocument, params: SplitParams
    ) -> tuple[list[DocumentChunk], str]:
        object_name = _extract_object_name(document.converted_doc_url)
        content = get_oss().download(object_name).read()
        file_type = get_file_type(document.converted_doc_url)
        if file_type in (FileType.EXCEL, FileType.CSV):
            chunks = split_excel(content, chunk_size=params.chunk_size or 500)
        else:
            text = content.decode("utf-8", errors="ignore")
            chunks = split(text, params)
        return chunks, _md5(content)

    def _incremental_split(
        self, document: KnowledgeDocument, chunks: list[DocumentChunk],
        old_segments: list[KnowledgeSegment],
    ) -> int:
        """增量分块：对比 chunk_md5，复用旧 segment（含 embedding），新建/删除变更的."""
        old_md_to_seg = {seg.chunk_md5: seg for seg in old_segments if seg.chunk_md5}
        new_mds: set[str] = set()
        to_save: list[KnowledgeSegment] = []
        to_update: list[KnowledgeSegment] = []
        reused = 0

        for i, chunk in enumerate(chunks):
            md = _md5(chunk.text.encode("utf-8"))
            new_mds.add(md)
            if md in old_md_to_seg:
                seg = old_md_to_seg[md]
                seg.chunk_order = i
                self._sync_segment_metadata(seg, document)
                to_update.append(seg)
                reused += 1
            else:
                to_save.append(self._build_segment(document, chunk, i, md))

        # 删除不再存在的旧 segment 及其 embedding
        to_delete = [seg for md, seg in old_md_to_seg.items() if md not in new_mds]
        self._delete_segments_and_embeddings_for(to_delete)

        if to_save:
            self.repo.save_segments(to_save)
        for seg in to_update:
            self.repo.update_segment(seg)
        logger.info("[incremental] reused={}, new={}, deleted={}", reused, len(to_save), len(to_delete))
        return reused + len(to_save)

    def _build_segment(
        self, document: KnowledgeDocument, chunk: DocumentChunk, order: int, md5_hash: str,
    ) -> KnowledgeSegment:
        """构建单个新 segment（含 chunk_md5，status=STORED 待向量化）."""
        metadata = dict(chunk.metadata)
        chunk_id = metadata.get(MetadataKey.CHUNK_ID) or f"{document.doc_id}-{order}"
        metadata.setdefault(MetadataKey.CHUNK_ID, chunk_id)
        metadata[MetadataKey.DOC_ID] = document.doc_id
        metadata[MetadataKey.FILE_NAME] = document.doc_title
        metadata[MetadataKey.URL] = document.doc_url
        if document.accessible_by:
            metadata[MetadataKey.ACCESSIBLE_BY] = document.accessible_by
        skip = metadata.get(MetadataKey.SKIP_EMBEDDING)
        return KnowledgeSegment(
            text=chunk.text,
            chunk_id=chunk_id,
            chunk_md5=md5_hash,
            metadata_=metadata,
            document_id=document.doc_id,
            chunk_order=order,
            skip_embedding=1 if skip == 1 else 0,
            status=SegmentStatus.STORED,
        )

    def _sync_segment_metadata(self, seg: KnowledgeSegment, document: KnowledgeDocument) -> None:
        """复用旧 segment 时同步 metadata（accessible_by 等与文档权限变化同步）."""
        metadata = dict(seg.metadata_ or {})
        metadata[MetadataKey.CHUNK_ID] = seg.chunk_id
        metadata[MetadataKey.DOC_ID] = document.doc_id
        metadata[MetadataKey.FILE_NAME] = document.doc_title
        metadata[MetadataKey.URL] = document.doc_url
        if document.accessible_by:
            metadata[MetadataKey.ACCESSIBLE_BY] = document.accessible_by
        else:
            metadata.pop(MetadataKey.ACCESSIBLE_BY, None)
        seg.metadata_ = metadata

    # ---------- embed ----------
    def embed_and_store(self, doc_id: int) -> bool:
        document = self.repo.get_document(doc_id)
        if document is None:
            return False
        if document.status == DocumentStatus.VECTOR_STORED:
            return True
        if document.status != DocumentStatus.CHUNKED:
            return False
        kb_type = document.knowledge_base_type.value if document.knowledge_base_type else None
        vectorstore = get_vectorstore(collection_for(kb_type))
        if vectorstore is None:
            raise RuntimeError("vectorstore 未配置")

        while True:
            segments = self.repo.get_pending_segments(doc_id)
            if not segments:
                break
            docs = [self._to_langchain_document(s, accessible_by=document.accessible_by) for s in segments]
            ids = [d.id for d in docs]
            for i in range(0, len(docs), 10):
                vectorstore.add_documents(docs[i:i + 10], ids=ids[i:i + 10])
            for seg, doc in zip(segments, docs):
                seg.embedding_id = doc.id
                seg.status = SegmentStatus.VECTOR_STORED
                self.repo.update_segment(seg)

        if self.repo.count_pending_segments(doc_id) == 0:
            document.status = DocumentStatus.VECTOR_STORED
            self.repo.update_document(document)
            return True
        return False

    def _to_langchain_document(
        self, segment: KnowledgeSegment, accessible_by: str | None = None,
    ) -> Document:
        metadata = dict(segment.metadata_ or {})
        metadata["document_id"] = segment.document_id
        metadata["chunk_id"] = segment.chunk_id
        metadata["chunk_order"] = segment.chunk_order
        metadata["segment_id"] = segment.id
        # 显式注入 accessible_by（覆盖 segment 旧值，保证向量 metadata 与文档权限一致，
        # 避免文档改权限后 segment.metadata_ 不同步导致召回过滤失效）
        if accessible_by:
            metadata[MetadataKey.ACCESSIBLE_BY] = accessible_by
        else:
            metadata.pop(MetadataKey.ACCESSIBLE_BY, None)
        doc_id = segment.embedding_id or f"doc-{segment.document_id}-segment-{segment.id}"
        return Document(id=doc_id, page_content=segment.text, metadata=metadata)

    # ---------- pipeline（后台全链路）----------
    def run_pipeline(self, doc_id: int) -> None:
        """后台全链路处理：解析 → 分块 → 向量化。

        每步独立 try/except，失败标记 status=FAILED + error_message，前端轮询可见。
        """
        document = self.repo.get_document(doc_id)
        if document is None:
            logger.warning("pipeline: document {} not found", doc_id)
            return
        if document.status != DocumentStatus.UPLOADED:
            logger.info("pipeline: document {} status={}, skip", doc_id, document.status)
            return

        file_name = document.doc_title or ""
        # 1. 解析（UPLOADED → CONVERTING → CONVERTED / STORED）
        try:
            content = get_oss().download(_extract_object_name(document.doc_url)).read()
            self._process_document(document, content, file_name)
        except Exception as e:
            # _process_document 内部已记录异常日志
            self._mark_failed(doc_id, f"解析失败: {e}")
            return
        # 解析后仍为 UPLOADED：未处理的文件类型（_process_document 仅 warning 返回）
        if document.status == DocumentStatus.UPLOADED:
            self._mark_failed(doc_id, f"不支持的文件类型: {file_name}")
            return
        # 非向量类型到 STORED 终态，无需分块/向量化
        if document.status == DocumentStatus.STORED:
            logger.info("pipeline: document {} reached STORED (non-vector)", doc_id)
            return

        # 2. 分块（CONVERTED → CHUNKED）
        try:
            self.split(doc_id, SplitParams())
        except Exception as e:
            logger.exception("document split failed: {}", doc_id)
            self._mark_failed(doc_id, f"分块失败: {e}")
            return

        # 3. 向量化（CHUNKED → VECTOR_STORED）
        try:
            self.embed_and_store(doc_id)
        except Exception as e:
            logger.exception("document embed failed: {}", doc_id)
            self._mark_failed(doc_id, f"向量化失败: {e}")
            return

        logger.info("pipeline done: document {} → VECTOR_STORED", doc_id)

    def _mark_failed(self, doc_id: int, message: str) -> None:
        self.db.rollback()  # 清理事务残留，确保错误标记能写入
        document = self.repo.get_document(doc_id)
        if document is None:
            return
        document.status = DocumentStatus.FAILED
        document.error_message = message[:1000]
        self.repo.update_document(document)
        logger.error("pipeline failed: document {} — {}", doc_id, message)

    # ---------- delete ----------
    def delete_document(self, doc_id: int) -> bool:
        document = self.repo.get_document(doc_id)
        if document is None:
            return False
        segments = self.repo.get_segments_by_document(doc_id)
        embedding_ids = [s.embedding_id for s in segments if s.embedding_id]
        if embedding_ids:
            vs = get_vectorstore()
            if vs:
                vs.delete(embedding_ids)
        self.repo.delete_segments_by_document(doc_id)
        self.repo.delete_document(doc_id)
        return True

    def _delete_segments_and_embeddings(self, document: KnowledgeDocument) -> None:
        segments = self.repo.get_segments_by_document(document.doc_id)
        embedding_ids = [s.embedding_id for s in segments if s.embedding_id]
        if embedding_ids:
            vs = get_vectorstore()
            if vs:
                vs.delete(embedding_ids)
        self.repo.delete_segments_by_document(document.doc_id)

    def _delete_segments_and_embeddings_for(self, segments: list[KnowledgeSegment]) -> None:
        """删除指定 segments 及其 embedding（增量删除用）."""
        if not segments:
            return
        embedding_ids = [s.embedding_id for s in segments if s.embedding_id]
        if embedding_ids:
            vs = get_vectorstore()
            if vs:
                vs.delete(embedding_ids)
        for seg in segments:
            self.db.delete(seg)
        self.db.commit()


def _md5(data: bytes) -> str:
    """计算 MD5（分块/文档内容指纹，增量更新用）."""
    return hashlib.md5(data).hexdigest()


def _strip_ext(file_name: str) -> str:
    dot = file_name.rfind(".")
    return file_name[:dot] if dot > 0 else file_name


def _extract_object_name(url: str) -> str:
    """从 OSS 公共 URL 提取 object name."""
    bucket = get_settings().s3_bucket or ""
    idx = url.rfind(bucket)
    if idx == -1:
        return url.rsplit("/", 1)[-1]
    start = idx + len(bucket) + 1
    return url[start:] if start < len(url) else ""


def run_document_pipeline(doc_id: int) -> None:
    """后台任务入口：独立 session 执行文档全链路处理（解析 → 分块 → 向量化）。

    用独立 SessionLocal（不复用请求 session），避免长时间占用请求连接池。
    由 FastAPI BackgroundTasks 调用。
    """
    from know_agent.db.postgres import SessionLocal

    if SessionLocal is None:
        logger.error("SessionLocal 未配置，无法执行后台任务 doc_id={}", doc_id)
        return
    db = SessionLocal()
    try:
        DocumentProcessService(db).run_pipeline(doc_id)
    except Exception:
        # run_pipeline 内部已对各步骤 try/except 标记 FAILED，这里兜底未预见异常
        logger.exception("文档处理后台任务未捕获异常 doc_id={}", doc_id)
        try:
            DocumentProcessService(db)._mark_failed(doc_id, "后台任务未捕获异常")
        except Exception:
            logger.exception("标记失败状态也失败 doc_id={}", doc_id)
    finally:
        db.close()
