"""文档服务测试 — splitter 分块策略 + 状态机流转 + 异步 pipeline 失败处理.

splitter 是纯函数，直接测各策略；service 用 mock repo/oss 隔离，测 upload 规范化、
_mark_failed、run_pipeline 状态机（含失败标记）。
"""

from unittest.mock import MagicMock

from know_agent.models.document import KnowledgeDocument
from know_agent.models.enums import DocumentStatus
from know_agent.services.document.service import DocumentProcessService, UploadParams
from know_agent.services.document.splitter import SplitParams, split, split_excel


# ---- splitter 分块策略 ----

def test_split_smart_by_header():
    text = "# 标题一\n内容一\n## 标题二\n内容二"
    chunks = split(text, SplitParams(split_type="SMART", chunk_size=500))
    assert len(chunks) >= 2
    assert all("chunkId" in c.metadata for c in chunks)


def test_split_length_creates_parent_child_for_oversized():
    text = "a" * 1200
    chunks = split(text, SplitParams(split_type="LENGTH", chunk_size=500))
    assert len(chunks) >= 2
    # 父块标记 skip_embedding=1（不向量化）
    assert chunks[0].metadata.get("skipEmbedding") == 1
    # 子块记录 parent_chunk_id
    children = [c for c in chunks if "parentChunkId" in c.metadata]
    assert len(children) >= 1


def test_split_excel_csv():
    content = b"name,age\nalice,30\nbob,25"
    chunks = split_excel(content, chunk_size=500)
    assert len(chunks) >= 1
    assert "alice" in chunks[0].text
    assert "bob" in chunks[-1].text


# ---- upload（异步化后仅入库 + OSS，不解析）----

def test_upload_normalizes_accessible_by_and_returns_uploaded(monkeypatch):
    mock_oss = MagicMock()
    mock_oss.upload_bytes.return_value = "http://oss/file.pdf"
    monkeypatch.setattr("know_agent.services.document.service.get_oss", lambda: mock_oss)

    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()

    params = UploadParams(upload_user="u", title="t", accessible_by=" admin , editor , ")
    doc = svc.upload("file.pdf", b"content", params)

    assert doc.status == DocumentStatus.UPLOADED  # 异步化后 upload 不再同步解析
    assert doc.accessible_by == "admin,editor"  # trim + 去空规范化
    assert doc.doc_url == "http://oss/file.pdf"
    svc.repo.save_document.assert_called_once()


def test_upload_sets_extension_for_table(monkeypatch):
    mock_oss = MagicMock()
    mock_oss.upload_bytes.return_value = "http://oss/f.csv"
    monkeypatch.setattr("know_agent.services.document.service.get_oss", lambda: mock_oss)

    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    params = UploadParams(upload_user="u", title="t", table_name="my_table")
    doc = svc.upload("f.csv", b"c", params)
    assert doc.extension == {"tableName": "my_table", "isOverride": False}


# ---- _mark_failed ----

def test_mark_failed_sets_status_and_error():
    doc = KnowledgeDocument(doc_id=1, doc_title="t", status=DocumentStatus.UPLOADED)
    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc

    svc._mark_failed(1, "解析失败: boom")

    assert doc.status == DocumentStatus.FAILED
    assert "解析失败" in doc.error_message
    svc.repo.update_document.assert_called_once()


def test_mark_failed_truncates_long_message():
    doc = KnowledgeDocument(doc_id=1, doc_title="t", status=DocumentStatus.UPLOADED)
    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc

    long_msg = "x" * 2000
    svc._mark_failed(1, long_msg)
    assert len(doc.error_message) == 1000  # 截断到 1000 字符


# ---- run_pipeline 状态机 ----

def test_run_pipeline_skips_non_uploaded():
    doc = KnowledgeDocument(doc_id=1, doc_title="t", status=DocumentStatus.VECTOR_STORED)
    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc

    svc.run_pipeline(1)  # 非 UPLOADED 直接 skip

    svc.repo.get_document.assert_called_once()  # 仅开头查询一次，不进入处理


def test_run_pipeline_marks_failed_on_parse_error(monkeypatch):
    mock_oss = MagicMock()
    mock_oss.download.side_effect = RuntimeError("oss down")
    monkeypatch.setattr("know_agent.services.document.service.get_oss", lambda: mock_oss)

    doc = KnowledgeDocument(
        doc_id=1, doc_title="f.pdf", status=DocumentStatus.UPLOADED, doc_url="http://oss/f.pdf"
    )
    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc

    svc.run_pipeline(1)

    assert doc.status == DocumentStatus.FAILED
    assert "解析失败" in doc.error_message


def test_run_pipeline_marks_failed_on_unsupported_type(monkeypatch):
    # 不支持的扩展名 → _process_document 不处理，status 仍 UPLOADED → 标记 FAILED
    mock_oss = MagicMock()
    mock_oss.download.return_value.read.return_value = b"content"
    monkeypatch.setattr("know_agent.services.document.service.get_oss", lambda: mock_oss)

    doc = KnowledgeDocument(
        doc_id=1, doc_title="f.unknown", status=DocumentStatus.UPLOADED, doc_url="http://oss/f.unknown"
    )
    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc

    svc.run_pipeline(1)

    assert doc.status == DocumentStatus.FAILED
    assert "不支持" in doc.error_message


def test_split_reuses_unchanged_segments(monkeypatch):
    """增量 split:相同 MD5 复用旧 segment(含 embedding),不同 MD5 新建,旧的不在新的删除."""
    from know_agent.models.document import KnowledgeSegment
    from know_agent.models.enums import SegmentStatus
    from know_agent.services.document.service import DocumentProcessService, _md5
    from know_agent.services.document.splitter import DocumentChunk, SplitParams

    text_a, text_b, text_c = "内容A", "内容B", "内容C"
    md_a, md_b = _md5(text_a.encode()), _md5(text_b.encode())
    doc = KnowledgeDocument(doc_id=1, doc_title="t", status=DocumentStatus.CHUNKED,
                            converted_doc_url="http://oss/f.md", content_md5="old")
    seg_a = KnowledgeSegment(id=1, text=text_a, chunk_md5=md_a, document_id=1, chunk_order=0,
                             status=SegmentStatus.VECTOR_STORED, embedding_id="emb_a", metadata_={})
    seg_b = KnowledgeSegment(id=2, text=text_b, chunk_md5=md_b, document_id=1, chunk_order=1,
                             status=SegmentStatus.VECTOR_STORED, embedding_id="emb_b", metadata_={})

    mock_vs = MagicMock()
    monkeypatch.setattr("know_agent.services.document.service.get_vectorstore",
                        lambda collection_name="know_agent": mock_vs)

    svc = DocumentProcessService(MagicMock())
    svc.repo = MagicMock()
    svc.repo.get_document.return_value = doc
    svc.repo.get_segments_by_document.return_value = [seg_a, seg_b]
    # mock _read_and_split: 返回 [chunk_a, chunk_c]（B 变成 C）
    monkeypatch.setattr(svc, "_read_and_split",
                        lambda d, p: ([DocumentChunk(text_a), DocumentChunk(text_c)], "new_md"))

    total = svc.split(1, SplitParams())

    assert total == 2  # 复用 seg_a + 新建 chunk_c
    # seg_a 复用（保留 embedding，不重新向量化）
    assert seg_a.status == SegmentStatus.VECTOR_STORED
    assert seg_a.embedding_id == "emb_a"
    # seg_b 的 embedding 被删除（MD5 不在新分块）
    mock_vs.delete.assert_called_once_with(["emb_b"])
    # 新建 chunk_c（pending 向量化）
    svc.repo.save_segments.assert_called_once()
    new_segs = svc.repo.save_segments.call_args[0][0]
    assert len(new_segs) == 1
    assert new_segs[0].text == text_c
    assert new_segs[0].status == SegmentStatus.STORED
    # document content_md5 更新（版本标识）
    assert doc.content_md5 == "new_md"
    assert doc.status == DocumentStatus.CHUNKED
