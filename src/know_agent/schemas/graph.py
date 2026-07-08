"""graph API 模型 — 对应源项目 dto/GraphRunRequest."""

from pydantic import BaseModel

from know_agent.schemas.agent import UserMessage


class GraphRunRequest(BaseModel):
    graphName: str
    userId: str | None = None
    threadId: str
    newMessage: UserMessage | None = None
    inputs: dict | None = None


class GraphResumeRequest(BaseModel):
    graphName: str
    userId: str | None = None
    threadId: str
    clarificationResponse: str
