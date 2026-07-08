"""MCP 客户端 — Jina 搜索 (langchain-mcp-adapters).

对应源项目 spring-ai-mcp-client 连接 Jina MCP 服务（SSE）。
"""

from langchain_mcp_adapters.client import MultiServerMCPClient

from know_agent.configuration import get_settings


def get_mcp_client() -> MultiServerMCPClient:
    s = get_settings()
    headers: dict[str, str] = {}
    if s.jina_api_key:
        headers["x-jina-api-key"] = s.jina_api_key
    return MultiServerMCPClient(
        {
            "jina": {
                "url": s.jina_mcp_url,
                "transport": "sse",
                "headers": headers or None,
            }
        }
    )


async def get_mcp_tools():
    """加载 Jina MCP 工具为 langchain tools."""
    client = get_mcp_client()
    return await client.get_tools()
