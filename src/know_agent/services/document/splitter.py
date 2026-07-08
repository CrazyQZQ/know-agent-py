"""文档分块 — 移植源项目 DocumentSplitterFactory + ExcelSplitter.

分块策略：
  - SMART/TITLE：按 Markdown 标题切分，再按 chunk_size 细分
  - SEPARATOR：按分隔符切分
  - REGEX：按正则切分
  - LENGTH：纯长度切分

超长块采用父子机制：父块标记 skip_embedding=1（不向量化），子块记录 parent_chunk_id。
"""

import io
import re
import uuid
from dataclasses import dataclass, field

import pandas as pd

from know_agent.models.enums import SplitType


class MetadataKey:
    """元数据键常量 — 对应源项目 MetadataKeyConstant."""

    FILE_NAME = "fileName"
    DOC_ID = "docId"
    CHUNK_ID = "chunkId"
    PARENT_CHUNK_ID = "parentChunkId"
    HEADER_LEVEL = "headerLevel"
    ACCESSIBLE_BY = "accessibleBy"
    URL = "url"
    SKIP_EMBEDDING = "skipEmbedding"


@dataclass
class DocumentChunk:
    text: str
    metadata: dict = field(default_factory=dict)


@dataclass
class SplitParams:
    split_type: str | None = None
    chunk_size: int | None = None
    overlap: int | None = None
    separator: str | None = None
    regex: str | None = None


DEFAULT_CHUNK_SIZE = 500


def _next_chunk_id() -> str:
    return uuid.uuid4().hex


def _normalize(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def split(text: str, params: SplitParams | None) -> list[DocumentChunk]:
    """按策略分块（对应源项目 DocumentSplitterFactory.split）."""
    params = params or SplitParams()
    split_type = _resolve_split_type(params)
    cs = _chunk_size(params)
    ov = _overlap(params)

    if split_type in (SplitType.TITLE, SplitType.SMART):
        overlap = max(ov, cs // 10) if split_type == SplitType.SMART else ov
        return _split_markdown_by_header(text, cs, overlap)
    if split_type == SplitType.SEPARATOR:
        return _split_by_separator(text, params.separator, cs, ov)
    if split_type == SplitType.REGEX:
        return _split_by_regex(text, params.regex, cs, ov)
    return _split_plain_text(text, cs, ov, {})


def _resolve_split_type(params: SplitParams) -> SplitType:
    if not params.split_type:
        return SplitType.SMART
    try:
        return SplitType(params.split_type)
    except ValueError:
        return SplitType.SMART


def _chunk_size(params: SplitParams) -> int:
    return params.chunk_size if params.chunk_size and params.chunk_size > 0 else DEFAULT_CHUNK_SIZE


def _overlap(params: SplitParams) -> int:
    return params.overlap if params.overlap and params.overlap >= 0 else 0


def _markdown_header_level(line: str) -> int:
    count = 0
    while count < len(line) and line[count] == "#":
        count += 1
    if count == 0 or count > 6:
        return 0
    return count if (len(line) == count or line[count] == " ") else 0


def _split_markdown_by_header(text: str, chunk_size: int, overlap: int) -> list[DocumentChunk]:
    lines = _normalize(text).split("\n")
    header_chunks: list[DocumentChunk] = []
    current: list[str] = []
    current_meta: dict = {}
    in_code_block = False

    for raw_line in lines:
        line = raw_line.strip()
        if line.startswith("```") or line.startswith("~~~"):
            in_code_block = not in_code_block
            current.append(raw_line)
            continue
        level = _markdown_header_level(line) if not in_code_block else 0
        if level > 0:
            _flush_chunk(header_chunks, current, current_meta)
            current_meta = dict(current_meta)
            current_meta[MetadataKey.HEADER_LEVEL] = level
            current_meta["header"] = line[level:].strip()
            current_meta[MetadataKey.CHUNK_ID] = _next_chunk_id()
        if line:
            current.append(raw_line)
    _flush_chunk(header_chunks, current, current_meta)

    if not header_chunks:
        return _split_plain_text(text, chunk_size, overlap, {})

    result: list[DocumentChunk] = []
    for chunk in header_chunks:
        _add_chunk_respecting_size(result, chunk.text, chunk.metadata, chunk_size, overlap)
    return result


def _flush_chunk(chunks: list[DocumentChunk], lines: list[str], metadata: dict) -> None:
    if not lines:
        return
    meta = dict(metadata)
    meta.setdefault(MetadataKey.CHUNK_ID, _next_chunk_id())
    chunks.append(DocumentChunk("\n".join(lines), meta))
    lines.clear()


def _split_by_separator(text: str, separator: str | None, chunk_size: int, overlap: int) -> list[DocumentChunk]:
    regex = re.escape(separator) if separator else r"\n\n+"
    return _split_by_regex(text, regex, chunk_size, overlap)


def _split_by_regex(text: str, regex: str | None, chunk_size: int, overlap: int) -> list[DocumentChunk]:
    regex = regex or r"\n\n+"
    chunks: list[DocumentChunk] = []
    for part in re.split(regex, _normalize(text)):
        if part.strip():
            _add_chunk_respecting_size(chunks, part.strip(), {}, chunk_size, overlap)
    return chunks


def _split_plain_text(text: str, chunk_size: int, overlap: int, metadata: dict) -> list[DocumentChunk]:
    chunks: list[DocumentChunk] = []
    _add_chunk_respecting_size(chunks, _normalize(text), metadata, chunk_size, overlap)
    return chunks


def _add_chunk_respecting_size(
    chunks: list[DocumentChunk], text: str, metadata: dict, chunk_size: int, overlap: int
) -> None:
    normalized = _normalize(text)
    if not normalized:
        return
    if len(normalized) <= chunk_size:
        meta = dict(metadata)
        meta.setdefault(MetadataKey.CHUNK_ID, _next_chunk_id())
        chunks.append(DocumentChunk(normalized, meta))
        return
    # 父块（跳过 embedding）
    parent_id = _next_chunk_id()
    parent_meta = dict(metadata)
    parent_meta[MetadataKey.CHUNK_ID] = parent_id
    parent_meta[MetadataKey.SKIP_EMBEDDING] = 1
    chunks.append(DocumentChunk(normalized, parent_meta))
    # 子块
    safe_overlap = max(0, min(overlap, chunk_size - 1))
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        child_meta = dict(metadata)
        child_meta[MetadataKey.CHUNK_ID] = _next_chunk_id()
        child_meta[MetadataKey.PARENT_CHUNK_ID] = parent_id
        chunks.append(DocumentChunk(normalized[start:end], child_meta))
        if end == len(normalized):
            break
        start = end - safe_overlap


def split_excel(content: bytes, chunk_size: int = 500, html_mode: bool = False) -> list[DocumentChunk]:
    """Excel/CSV 分块（对应源项目 ExcelSplitter，用 pandas 替代 EasyExcel）."""
    rows = _read_rows(content)
    if len(rows) < 2:
        return []
    cleaned = [[_clean_cell(c) for c in row] for row in rows]
    texts = _to_html_chunks(cleaned, chunk_size) if html_mode else _to_keyvalue_chunks(cleaned, chunk_size)
    return [DocumentChunk(t, {MetadataKey.CHUNK_ID: _next_chunk_id()}) for t in texts]


def _read_rows(content: bytes) -> list[list[str]]:
    if content[:4] == b"PK\x03\x04":
        df = pd.read_excel(io.BytesIO(content), header=None, dtype=str)
    else:
        df = pd.read_csv(io.BytesIO(content), header=None, dtype=str)
    df = df.fillna("")
    return df.values.tolist()


def _to_keyvalue_chunks(rows: list[list[str]], chunk_size: int) -> list[str]:
    headers = rows[0]
    chunks: list[str] = []
    current = ""
    for row in rows[1:]:
        row_text = _row_to_keyvalue(headers, row)
        if not row_text.strip():
            continue
        if current and len(current) + len(row_text) + 1 > chunk_size:
            chunks.append(current)
            current = ""
        if current:
            current += "\n"
        current += row_text
    if current:
        chunks.append(current)
    return chunks


def _row_to_keyvalue(headers: list[str], row: list[str]) -> str:
    values = []
    for i in range(min(len(headers), len(row))):
        h = headers[i].strip()
        v = row[i].strip()
        if h or v:
            values.append(f"{h}: {v}")
    return "; ".join(values)


def _to_html_chunks(rows: list[list[str]], chunk_size: int) -> list[str]:
    """HTML 表格模式（保留接口，默认走 keyvalue）."""
    return _to_keyvalue_chunks(rows, chunk_size)


def _clean_cell(cell) -> str:
    if cell is None:
        return ""
    return re.sub(r"[\x00-\x09\x0b-\x0c\x0e-\x1f]", "", str(cell))
