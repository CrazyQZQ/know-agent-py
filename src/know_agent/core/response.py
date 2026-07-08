"""统一响应封装 — 对应 Java 项目的 R<T> / ReturnCode."""

from enum import IntEnum
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ReturnCode(IntEnum):
    SUCCESS = 200
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    INTERNAL_ERROR = 500


class R(BaseModel, Generic[T]):
    code: int = ReturnCode.SUCCESS
    msg: str = "success"
    data: T | None = None

    @classmethod
    def ok(cls, data: T | None = None, msg: str = "success") -> "R[T]":
        return cls(code=ReturnCode.SUCCESS, msg=msg, data=data)

    @classmethod
    def fail(cls, msg: str, code: int = ReturnCode.INTERNAL_ERROR) -> "R[T]":
        return cls(code=code, msg=msg, data=None)
