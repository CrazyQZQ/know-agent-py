"""agent API 模型 — 对应源项目 dto/AgentRunRequest / AgentResumeRequest / Thread."""

from pydantic import BaseModel


class UserMessage(BaseModel):
    content: str
    role: str = "user"


class ToolFeedback(BaseModel):
    id: str
    name: str | None = None
    arguments: dict | None = None
    result: str = "APPROVED"  # APPROVED / REJECTED / EDITED
    description: str | None = None


class AgentRunRequest(BaseModel):
    appName: str
    userId: str | None = None
    threadId: str
    newMessage: UserMessage
    streaming: bool = False
    stateDelta: dict | None = None


class AgentResumeRequest(BaseModel):
    appName: str
    userId: str | None = None
    threadId: str
    newMessage: UserMessage | None = None
    threadName: str | None = None
    toolFeedbacks: list[ToolFeedback] = []


class ThreadOut(BaseModel):
    thread_id: str
    values: dict | None = None
