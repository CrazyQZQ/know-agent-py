"""内容注入 — 结构化输出 + 引用标注，让 agent 可引用来源.

返回格式：
  共检索到 N 条相关知识：

  [1] 来源:《文档名》 | 相关度:0.953
  文本内容...

  ---

  [2] 来源:《文档名》 | 相关度:0.871
  ...
"""

from know_agent.services.document.search import SearchResult


def inject(results: list[SearchResult]) -> str:
    """将检索结果结构化注入为带引用标注的上下文文本."""
    if not results:
        return "未检索到相关信息。"
    parts: list[str] = []
    for i, r in enumerate(results, 1):
        meta = r.metadata or {}
        # MetadataKey.FILE_NAME = "fileName"（沿用源项目驼峰命名）
        doc_title = (
            meta.get("fileName")
            or meta.get("file_name")
            or meta.get("doc_title")
            or "未知文档"
        )
        parts.append(
            f"[{i}] 来源:《{doc_title}》 | 相关度:{r.score:.3f}\n{r.text}"
        )
    header = f"共检索到 {len(results)} 条相关知识："
    return header + "\n\n" + "\n\n---\n\n".join(parts)
