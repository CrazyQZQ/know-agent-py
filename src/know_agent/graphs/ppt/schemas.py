"""PPT graph 结构化 schema - requirement 澄清项的结构化输出模型.

供 requirement_node 的 with_structured_output 使用，让澄清阶段产出
结构化的建议选项（每项带 question + 候选 options + 是否允许自定义），
而非纯文本提问，前端可据此渲染"选项卡片 + 自由输入框"。
"""

from pydantic import BaseModel, Field


class ClarificationOption(BaseModel):
    """单个建议选项."""

    label: str = Field(description="展示文本，如 '标准 10 页'")
    value: str = Field(description="提交值，如 '10'")


class ClarificationItem(BaseModel):
    """一个待澄清维度（主题/页数/风格/受众等）."""

    id: str = Field(description="维度标识: topic/pages/style/audience")
    question: str = Field(description="面向用户的提问文案")
    options: list[ClarificationOption] = Field(
        default_factory=list,
        description="建议选项 2-4 个；纯开放问题可留空",
    )
    allow_custom: bool = Field(default=True, description="是否允许用户自行输入")
    multiple: bool = Field(default=False, description="是否允许选择多个选项")
    required: bool = Field(default=True, description="是否必填")


class RequirementClarification(BaseModel):
    """requirement_node 结构化输出."""

    complete: bool = Field(description="信息是否充足，可直接生成 PPT")
    requirement: str = Field(default="", description="complete=true 时输出已确认的需求要素小结")
    items: list[ClarificationItem] = Field(
        default_factory=list,
        description="complete=false 时输出待澄清项，每项带建议选项",
    )
