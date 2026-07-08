"""文档处理服务 — 状态机：upload → process → split → embed.

对应源项目 DocumentProcessServiceImpl + MinerUProcessBaseServiceImpl（processDocument 部分）。
源项目 processDocument 异步（虚拟线程），这里简化为同步：upload 接口内完成解析。

split 后分块入 MySQL（业务）；embed 时入 pgvector（向量）。
关键词检索使用 PG 内置 pg_trgm（见 services/document/search.py），无需额外入库。
混合检索 = pg_trgm 关键词 + pgvector 向量 + RRF 融合。
"""

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
from know_agent.services.document.vectorstore import get_vectorstore
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
        # 同步解析（源项目异步，这里简化）
        self._process_document(document, content, file_name)
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

    # ---------- split ----------
    def split(self, doc_id: int, params: SplitParams) -> int:
        document = self.repo.get_document(doc_id)
        if document is None:
            raise ValueError(f"document {doc_id} not found")
        if not document.converted_doc_url:
            raise ValueError("document has not been converted")

        if document.status in (DocumentStatus.CHUNKED, DocumentStatus.VECTOR_STORED):
            self._delete_segments_and_embeddings(document)
            document.status = DocumentStatus.CONVERTED
            self.repo.update_document(document)
        if document.status != DocumentStatus.CONVERTED:
            raise ValueError(f"document status must be CONVERTED, got {document.status}")

        chunks = self._read_and_split(document, params)
        segments = self._build_segments(document, chunks)
        self.repo.save_segments(segments)
        document.status = DocumentStatus.CHUNKED
        self.repo.update_document(document)
        logger.info("document {} split into {} segments", doc_id, len(segments))
        return len(segments)

    def _read_and_split(self, document: KnowledgeDocument, params: SplitParams) -> list[DocumentChunk]:
        object_name = _extract_object_name(document.converted_doc_url)
        content = get_oss().download(object_name).read()
        file_type = get_file_type(document.converted_doc_url)
        if file_type in (FileType.EXCEL, FileType.CSV):
            return split_excel(content, chunk_size=params.chunk_size or 500)
        text = content.decode("utf-8", errors="ignore")
        return split(text, params)

    def _build_segments(
        self, document: KnowledgeDocument, chunks: list[DocumentChunk]
    ) -> list[KnowledgeSegment]:
        segments: list[KnowledgeSegment] = []
        for i, chunk in enumerate(chunks):
            metadata = dict(chunk.metadata)
            chunk_id = metadata.get(MetadataKey.CHUNK_ID) or f"{document.doc_id}-{i}"
            metadata.setdefault(MetadataKey.CHUNK_ID, chunk_id)
            metadata[MetadataKey.DOC_ID] = document.doc_id
            metadata[MetadataKey.FILE_NAME] = document.doc_title
            metadata[MetadataKey.URL] = document.doc_url
            if document.accessible_by:
                metadata[MetadataKey.ACCESSIBLE_BY] = document.accessible_by
            skip = metadata.get(MetadataKey.SKIP_EMBEDDING)
            segments.append(KnowledgeSegment(
                text=chunk.text,
                chunk_id=chunk_id,
                metadata_=metadata,
                document_id=document.doc_id,
                chunk_order=i,
                skip_embedding=1 if skip == 1 else 0,
                status=SegmentStatus.STORED,
            ))
        return segments

    # ---------- embed ----------
    def embed_and_store(self, doc_id: int) -> bool:
        document = self.repo.get_document(doc_id)
        if document is None:
            return False
        if document.status == DocumentStatus.VECTOR_STORED:
            return True
        if document.status != DocumentStatus.CHUNKED:
            return False
        vectorstore = get_vectorstore()
        if vectorstore is None:
            raise RuntimeError("vectorstore 未配置")

        while True:
            segments = self.repo.get_pending_segments(doc_id)
            if not segments:
                break
            docs = [self._to_langchain_document(s) for s in segments]
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

    def _to_langchain_document(self, segment: KnowledgeSegment) -> Document:
        metadata = dict(segment.metadata_ or {})
        metadata["document_id"] = segment.document_id
        metadata["chunk_id"] = segment.chunk_id
        metadata["chunk_order"] = segment.chunk_order
        metadata["segment_id"] = segment.id
        doc_id = segment.embedding_id or f"doc-{segment.document_id}-segment-{segment.id}"
        return Document(id=doc_id, page_content=segment.text, metadata=metadata)

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
