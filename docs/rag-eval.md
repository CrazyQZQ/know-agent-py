# RAG 评估体系

用 LLM 评判量化 RAG pipeline 的检索 + 回答质量，为 RAG 调参（top_k、rerank、multi_query 等）提供数据支撑。

> **未用 ragas**：ragas 0.4.x 与项目 langchain_community 0.4 不兼容（ragas import 已移除的 `langchain_community.chat_models.vertexai`），降级 langchain_community 会影响项目。故用 LLM 评判自建评估脚本，指标定义与 ragas 一致。

## 评估指标（LLM 评判 0/1，全样本平均）

| 指标 | 含义 | 评判依据 |
|---|---|---|
| `context_recall` | 检索是否覆盖标准答案所需信息 | 检索 contexts 是否含标准答案所需信息 |
| `context_precision` | 检索结果是否相关 | 检索 contexts 是否与问题相关 |
| `faithfulness` | 回答是否忠于检索上下文（不编造） | response 是否仅基于 contexts |
| `answer_relevancy` | 回答是否切题 | response 是否回应了问题 |

## 数据集格式

`data/rag_eval.jsonl`，每行一条 JSON：

```json
{"user_input": "查询", "reference": "标准答案", "reference_contexts": ["标准上下文1", "..."]}
```

- `user_input`:评估查询
- `reference`:人工标注的标准答案（评 faithfulness/answer_relevancy）
- `reference_contexts`:标准上下文（评 context_recall/context_precision，当前脚本用 reference 评判，reference_contexts 备用）

> 示例数据集 `data/rag_eval.jsonl` 是占位，**请替换为与你的知识库文档匹配的真实评估数据**（建议 20+ 条覆盖典型查询）。

## 跑评估

```bash
uv run python scripts/eval_rag.py --data data/rag_eval.jsonl --top-k 5
```

需要：`DATABASE_URL`（检索）+ `DEEPSEEK_API_KEY`（LLM 改写/回答/评判）+ `ARK_API_KEY`（embedding）。

脚本流程：
1. 加载数据集
2. 对每条：RagPipeline 检索 contexts -> LLM 基于 contexts 生成 response -> LLM 评判 4 指标（0/1）
3. 汇总各指标平均值，输出到 `rag_eval_result.json`

每条样本 5 次 LLM 调用（1 改写 + 1 回答 + 3 评判，改写含 multi-query/HyDE 实际更多），成本与样本数成正比。

## 量化调参

调整 RAG 参数后重跑评估，对比指标变化：

- `RAG_TOP_K` / `RAG_CANDIDATE_POOL`:检索数量
- `RAG_MULTI_QUERY` / `RAG_HYDE`:查询改写
- `RAG_RERANK`:重排序

指标提升即调参有效。建议建立基线（默认参数），每次调参对比。
