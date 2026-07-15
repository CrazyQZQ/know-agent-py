"""验证 graphs 包扫描自动注册 ppt_build."""

def test_ppt_graph_auto_registered():
    import know_agent.graphs  # 触发 __init__.py 扫描
    from know_agent.graphs.registry import list_graphs

    names = [r.name for r in list_graphs()]
    assert "ppt_build" in names


def test_ppt_graph_has_title_and_description():
    import know_agent.graphs
    from know_agent.graphs.registry import get_graph

    reg = get_graph("ppt_build")
    assert reg.title == "PPT 生成"
    assert reg.description  # 非空
