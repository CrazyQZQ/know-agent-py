"""天气查询工具 — 源项目 WeatherTool 已删除，这里给简化实现.

可按需替换为真实天气 API（如和风天气、OpenWeather）。
"""

from langchain_core.tools import tool


@tool
def get_weather(city: str) -> str:
    """查询指定城市的天气."""
    # 占位实现，后续可接入真实天气 API
    return f"{city}：晴，气温 25℃，湿度 40%，微风。"
