"""graph API 模型 — 对应源项目 dto/GraphRunRequest."""

from pydantic import BaseModel

from know_agent.schemas.agent import UserMessage


class GraphRunRequest(BaseModel):
    graphName: str
    userId: str | None = None
    threadId: str
    newMessage: UserMessage | None = None
    inputs: dict | None = None


class ResumeAnswer(BaseModel):
    """单个澄清维度的用户回答（结构化提交）."""

    id: str
    value: str                       # 选中的 option.value 或自由输入文本
    label: str | None = None         # 选中的 option.label 或自由输入原文，便于 LLM 理解


class GraphResumeRequest(BaseModel):
    graphName: str
    userId: str | None = None
    threadId: str
    clarificationResponse: str | None = None    # 兼容旧前端：纯文本
    answers: list[ResumeAnswer] | None = None   # 新：结构化回答
