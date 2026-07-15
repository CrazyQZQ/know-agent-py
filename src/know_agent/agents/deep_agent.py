from deepagents import create_deep_agent

from know_agent.agents.react_agent import get_tools
from know_agent.configuration import get_settings
from know_agent.llm.chat import get_chat_model

s = get_settings()
deep_agent = create_deep_agent(model=get_chat_model(), tools=get_tools(),
                               system_prompt="You are a research assistant.", )

if __name__ == '__main__':
    deep_agent.invoke({"messages": "Research LangGraph and write a summary"})
