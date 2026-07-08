"""RAG 评估脚本 - LLM 评判 RAG pipeline 检索 + 回答质量.

用 LLM 评判 4 个指标（0/1），不依赖 ragas（ragas 0.4.x 与 langchain_community 0.4
不兼容：ragas import 已移除的 langchain_community.chat_models.vertexai）。

用法:
    uv run python scripts/eval_rag.py [--data data/rag_eval.jsonl] [--top-k 5] [--out rag_eval_result.json]

数据集格式（jsonl，每行一条）:
    {"user_input": "查询", "reference": "标准答案", "reference_contexts": ["标准上下文1", ...]}

评估指标（LLM 评判 0/1，全样本平均）:
    - context_recall:    检索是否覆盖标准答案所需信息
    - context_precision: 检索结果是否相关
    - faithfulness:      回答是否忠于检索上下文（不编造）
    - answer_relevancy:  回答是否切题

需要：DATABASE_URL（检索）+ DEEPSEEK_API_KEY（LLM 改写/回答/评判）+ ARK_API_KEY（embedding）
"""

import argparse
import json
import re
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from know_agent.db.postgres import SessionLocal
from know_agent.llm.chat import get_chat_model
from know_agent.services.document.rag.pipeline import RagPipeline
from know_agent.services.document.search import SearchService


def retrieve_contexts(query: str, top_k: int = 5) -> list[str]:
    """用 RAG pipeline 检索 contexts（transformer -> retriever）."""
    db = SessionLocal()
    try:
        pipeline = RagPipeline(SearchService(db))
        queries = pipeline.transformer.transform(query)
        candidates = pipeline.retriever.retrieve(queries, top_n=top_k)
        return [c.text for c in candidates]
    finally:
        db.close()


def generate_response(query: str, contexts: list[str]) -> str:
    """用 LLM 基于 contexts 生成回答（模拟 agent 回答）."""
    llm = get_chat_model()
    context_text = "\n\n".join(contexts) if contexts else "（无相关上下文）"
    messages = [
        SystemMessage(content=f"基于以下上下文回答用户问题，上下文不足时说明：\n\n上下文:\n{context_text}"),
        HumanMessage(content=query),
    ]
    return llm.invoke(messages).content


def llm_judge(prompt: str) -> int:
    """LLM 评判，返回 0 或 1（解析首个 0/1 字符）."""
    llm = get_chat_model()
    resp = llm.invoke(prompt).content.strip()
    m = re.search(r"[01]", resp)
    return int(m.group()) if m else 0


def eval_sample(item: dict, top_k: int) -> dict:
    query = item["user_input"]
    reference = item.get("reference", "")
    contexts = retrieve_contexts(query, top_k=top_k)
    response = generate_response(query, contexts)
    ctx_text = "\n".join(contexts) or "（无）"

    context_recall = llm_judge(
        f"问题: {query}\n标准答案: {reference}\n检索上下文:\n{ctx_text}\n\n"
        f"判断：检索上下文是否包含回答标准答案所需的信息？只回答 0（否）或 1（是）。"
    )
    context_precision = llm_judge(
        f"问题: {query}\n检索上下文:\n{ctx_text}\n\n"
        f"判断：检索上下文是否与问题相关（至少一条相关即 1）？只回答 0（否）或 1（是）。"
    )
    faithfulness = llm_judge(
        f"问题: {query}\n检索上下文:\n{ctx_text}\n回答: {response}\n\n"
        f"判断：回答是否仅基于检索上下文（未编造上下文外的信息）？只回答 0（否）或 1（是）。"
    )
    answer_relevancy = llm_judge(
        f"问题: {query}\n回答: {response}\n\n"
        f"判断：回答是否切题（回应了问题）？只回答 0（否）或 1（是）。"
    )
    return {
        "user_input": query,
        "response": response,
        "contexts": contexts,
        "context_recall": context_recall,
        "context_precision": context_precision,
        "faithfulness": faithfulness,
        "answer_relevancy": answer_relevancy,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="RAG 评估（LLM 评判）")
    parser.add_argument("--data", default="data/rag_eval.jsonl", help="评估数据集 jsonl")
    parser.add_argument("--top-k", type=int, default=5, help="检索 top_k")
    parser.add_argument("--out", default="rag_eval_result.json", help="评估结果输出")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        logger.error("评估数据集不存在: {}", data_path)
        return
    raw = [json.loads(line) for line in data_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    logger.info("加载 {} 条评估样本", len(raw))

    results = []
    for i, item in enumerate(raw, 1):
        logger.info("[{}/{}] 评估: {}", i, len(raw), item["user_input"][:50])
        results.append(eval_sample(item, args.top_k))

    n = len(results)
    summary = {
        "count": n,
        "context_recall": sum(r["context_recall"] for r in results) / n if n else 0,
        "context_precision": sum(r["context_precision"] for r in results) / n if n else 0,
        "faithfulness": sum(r["faithfulness"] for r in results) / n if n else 0,
        "answer_relevancy": sum(r["answer_relevancy"] for r in results) / n if n else 0,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    Path(args.out).write_text(
        json.dumps({"summary": summary, "samples": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("评估结果已写入 {}", args.out)


if __name__ == "__main__":
    main()
