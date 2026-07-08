"""多知识库 collection 隔离测试 — collection_for + 动态缓存 + 写入/检索选 collection."""

from unittest.mock import MagicMock

from know_agent.services.document.vectorstore import DEFAULT_COLLECTION, collection_for, get_vectorstore


# ---- collection_for 纯函数 ----

def test_collection_for_default():
    assert collection_for(None) == DEFAULT_COLLECTION
    assert collection_for("") == DEFAULT_COLLECTION


def test_collection_for_by_kb_type():
    assert collection_for("DOCUMENT_SEARCH") == "know_agent_DOCUMENT_SEARCH"
    assert collection_for("DATA_QUERY") == "know_agent_DATA_QUERY"


# ---- get_vectorstore 按 collection_name 缓存 ----

def test_get_vectorstore_caches_per_collection(monkeypatch):
    """不同 collection_name 返回不同实例，同 collection 复用缓存."""
    created: dict[str, object] = {}

    def fake_pg(**kwargs):
        name = kwargs["collection_name"]
        vs = MagicMock(name=name)
        created[name] = vs
        return vs

    monkeypatch.setattr("know_agent.services.document.vectorstore.PGVector", fake_pg)
    monkeypatch.setattr("know_agent.services.document.vectorstore.get_embeddings", lambda: MagicMock())
    s = MagicMock()
    s.database_url_safe = "postgresql://x"
    monkeypatch.setattr("know_agent.services.document.vectorstore.get_settings", lambda: s)
    get_vectorstore.cache_clear()

    vs_default = get_vectorstore()
    vs_doc = get_vectorstore(collection_for("DOCUMENT_SEARCH"))
    vs_data = get_vectorstore(collection_for("DATA_QUERY"))

    # 同 collection 复用缓存实例
    assert get_vectorstore() is vs_default
    # 不同 collection 不同实例（隔离）
    assert vs_default is not vs_doc
    assert vs_doc is not vs_data

    get_vectorstore.cache_clear()


# ---- 检索按 kb 选 collection ----

def test_vector_search_uses_kb_type_collection(monkeypatch):
    """vector_search 传 knowledge_base_type 时用对应 collection."""
    from know_agent.services.document.search import SearchService

    called: list[str] = []

    def fake_get_vs(collection_name=DEFAULT_COLLECTION):
        called.append(collection_name)
        mock_vs = MagicMock()
        mock_vs.similarity_search_with_score.return_value = []
        return mock_vs

    monkeypatch.setattr("know_agent.services.document.search.get_vectorstore", fake_get_vs)

    svc = SearchService(db=MagicMock())  # __init__ 调 get_vectorstore() → 默认 collection
    svc.vector_search("q", top_k=5, knowledge_base_type="DOCUMENT_SEARCH")
    assert called[-1] == "know_agent_DOCUMENT_SEARCH"


def test_vector_search_defaults_to_default_collection(monkeypatch):
    """不传 knowledge_base_type 时用 __init__ 的默认 collection（向后兼容）."""
    from know_agent.services.document.search import SearchService

    called: list[str] = []

    def fake_get_vs(collection_name=DEFAULT_COLLECTION):
        called.append(collection_name)
        mock_vs = MagicMock()
        mock_vs.similarity_search_with_score.return_value = []
        return mock_vs

    monkeypatch.setattr("know_agent.services.document.search.get_vectorstore", fake_get_vs)

    svc = SearchService(db=MagicMock())
    svc.vector_search("q", top_k=5)  # 不指定 kb
    # __init__ 调一次，vector_search 不再调（用 self.vectorstore）
    assert called == [DEFAULT_COLLECTION]


# ---- 写入按 kb 选 collection ----

def test_embed_and_store_uses_kb_type_collection(monkeypatch):
    """embed_and_store 按 document.knowledge_base_type 选 collection 写入."""
    from know_agent.models.document import KnowledgeDocument, KnowledgeSegment
    from know_agent.models.enums import DocumentStatus, KnowledgeBaseType, SegmentStatus
    from know_agent.services.document.service import DocumentProcessService

    called: list[str] = []

    def fake_get_vs(collection_name=DEFAULT_COLLECTION):
        called.append(collection_name)
        return MagicMock()

    monkeypatch.setattr("know_agent.services.document.service.get_vectorstore", fake_get_vs)

    doc = KnowledgeDocument(
        doc_id=1, doc_title="t", status=DocumentStatus.CHUNKED,
        knowledge_base_type=KnowledgeBaseType.DOCUMENT_SEARCH,
    )
    segment = KnowledgeSegment(
        id=1, text="hello", document_id=1, chunk_order=0,
        status=SegmentStatus.STORED, skip_embedding=0, metadata_={},
    )

    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc
    svc.repo.get_pending_segments.side_effect = [[segment], []]
    svc.repo.count_pending_segments.return_value = 0

    assert svc.embed_and_store(1) is True
    assert called[-1] == "know_agent_DOCUMENT_SEARCH"
    assert doc.status == DocumentStatus.VECTOR_STORED


def test_embed_and_store_injects_accessible_by(monkeypatch):
    """embed_and_store 把 document.accessible_by 注入向量 metadata，保证召回可按角色过滤."""
    from know_agent.models.document import KnowledgeDocument, KnowledgeSegment
    from know_agent.models.enums import DocumentStatus, KnowledgeBaseType, SegmentStatus
    from know_agent.services.document.service import DocumentProcessService

    added: list = []

    def fake_add(docs, ids):
        added.extend(docs)

    mock_vs = MagicMock()
    mock_vs.add_documents = fake_add
    monkeypatch.setattr(
        "know_agent.services.document.service.get_vectorstore",
        lambda collection_name="know_agent": mock_vs,
    )

    doc = KnowledgeDocument(
        doc_id=1, doc_title="t", status=DocumentStatus.CHUNKED,
        knowledge_base_type=KnowledgeBaseType.DOCUMENT_SEARCH,
        accessible_by="admin,editor",
    )
    segment = KnowledgeSegment(
        id=1, text="hello", document_id=1, chunk_order=0,
        status=SegmentStatus.STORED, skip_embedding=0, metadata_={},
    )

    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc
    svc.repo.get_pending_segments.side_effect = [[segment], []]
    svc.repo.count_pending_segments.return_value = 0

    svc.embed_and_store(1)

    assert len(added) == 1
    assert added[0].metadata["accessibleBy"] == "admin,editor"


def test_embed_and_store_omits_accessible_by_for_public(monkeypatch):
    """公开文档 embed 时清除 segment 旧 accessibleBy（_can_access 视为公开）."""
    from know_agent.models.document import KnowledgeDocument, KnowledgeSegment
    from know_agent.models.enums import DocumentStatus, KnowledgeBaseType, SegmentStatus
    from know_agent.services.document.service import DocumentProcessService

    added: list = []

    def fake_add(docs, ids):
        added.extend(docs)

    mock_vs = MagicMock()
    mock_vs.add_documents = fake_add
    monkeypatch.setattr(
        "know_agent.services.document.service.get_vectorstore",
        lambda collection_name="know_agent": mock_vs,
    )

    doc = KnowledgeDocument(
        doc_id=1, doc_title="t", status=DocumentStatus.CHUNKED,
        knowledge_base_type=KnowledgeBaseType.DOCUMENT_SEARCH,
        accessible_by=None,
    )
    segment = KnowledgeSegment(
        id=1, text="hello", document_id=1, chunk_order=0,
        status=SegmentStatus.STORED, skip_embedding=0,
        metadata_={"accessibleBy": "stale_role"},  # segment 旧值，应被清除
    )

    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc
    svc.repo.get_pending_segments.side_effect = [[segment], []]
    svc.repo.count_pending_segments.return_value = 0

    svc.embed_and_store(1)

    assert len(added) == 1
    assert "accessibleBy" not in added[0].metadata
