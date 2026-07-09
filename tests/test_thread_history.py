"""thread 会话历史测试 - 从 checkpoint 取历史消息并格式化."""

from know_agent.agents import thread as thread_service


class _Msg:
    def __init__(self, msg_type, content):
        self.type = msg_type
        self.content = content


class _State:
    def __init__(self, messages):
        self.checkpoint = {"channel_values": {"messages": messages}} if messages else {}


class _FakeCp:
    def __init__(self, state):
        self._state = state

    def get_tuple(self, config):
        return self._state


def test_get_thread_history_formats_messages(monkeypatch):
    state = _State([
        _Msg("human", "你好"),
        _Msg("ai", "你好，有什么可以帮你"),
        _Msg("tool", "tool result"),  # 跳过（非对话）
        _Msg("ai", ""),  # 跳过（空内容）
    ])
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp(state))

    history = thread_service.get_thread_history("t1")
    assert history == [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "你好，有什么可以帮你"},
    ]


def test_get_thread_history_empty(monkeypatch):
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp(_State([])))
    assert thread_service.get_thread_history("t1") == []


def test_get_thread_history_no_checkpointer(monkeypatch):
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: None)
    assert thread_service.get_thread_history("t1") == []


def test_get_thread_returns_messages(monkeypatch):
    state = _State([_Msg("human", "hi"), _Msg("ai", "hello")])
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp(state))
    t = thread_service.get_thread("t1")
    assert t == {"thread_id": "t1", "messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]}


class _FakeResult:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def scalar(self):
        return self._scalar


class _FakeDb:
    def __init__(self, exists=False):
        self.exists = exists
        self.calls = []
        self.commits = 0
        self.closed = False

    def execute(self, sql, params=None):
        text = str(sql)
        self.calls.append((text, params or {}))
        if "SELECT EXISTS" in text:
            return _FakeResult(scalar=self.exists)
        if "SELECT 1 FROM checkpoints" in text:
            return _FakeResult()
        return _FakeResult()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.calls.append(("ROLLBACK", {}))

    def close(self):
        self.closed = True


class _FakeCheckpointer:
    def __init__(self):
        self.deleted_threads = []

    def delete_thread(self, thread_id):
        self.deleted_threads.append(thread_id)


def test_ensure_thread_meta_inserts_default_title_once(monkeypatch):
    db = _FakeDb(exists=False)
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)

    created = thread_service.ensure_thread_meta("t1", "app", "u1", first_message="帮我写一个PPT")

    assert created is True
    assert any("INSERT INTO agent_threads" in sql for sql, _ in db.calls)
    insert_params = next(params for sql, params in db.calls if "INSERT INTO agent_threads" in sql)
    assert insert_params["thread_id"] == "t1"
    assert insert_params["name"] == "帮我写一个PPT"
    assert db.commits == 1
    assert db.closed is True


def test_ensure_thread_meta_does_not_insert_existing(monkeypatch):
    db = _FakeDb(exists=True)
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)

    created = thread_service.ensure_thread_meta("t1", "app", "u1", first_message="hi")

    assert created is False
    assert not any("INSERT INTO agent_threads" in sql for sql, _ in db.calls)


def test_generate_and_update_thread_title_uses_title_model(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)

    class _Msg:
        content = "  需求分析  "

    class _Model:
        def invoke(self, messages):
            self.messages = messages
            return _Msg()

    model = _Model()
    monkeypatch.setattr(thread_service, "get_thread_title_model", lambda: model)

    title = thread_service.generate_and_update_thread_title("t1", "我要做一个知识库问答系统")

    assert title == "需求分析"
    update_params = next(params for sql, params in db.calls if "UPDATE agent_threads" in sql)
    assert update_params == {"thread_id": "t1", "name": "需求分析"}


def test_generate_thread_title_falls_back_to_message_on_model_error(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)

    class _Model:
        def invoke(self, messages):
            raise RuntimeError("boom")

    monkeypatch.setattr(thread_service, "get_thread_title_model", lambda: _Model())

    title = thread_service.generate_and_update_thread_title("t1", "这是一个很长很长的用户问题，需要截断成标题")

    assert title == "这是一个很长很长的用户问题，需要截断成标题"


def test_delete_thread_deletes_metadata_even_without_checkpoint_table(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: None)

    deleted = thread_service.delete_thread("t1")

    assert deleted is True
    assert any("DELETE FROM agent_threads" in sql for sql, _ in db.calls)
    assert db.commits == 1


def test_delete_thread_scopes_metadata_by_app_and_user(monkeypatch):
    db = _FakeDb()
    db.exists = True
    cp = _FakeCheckpointer()
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: cp)

    deleted = thread_service.delete_thread("t1", "common_agent", "u1")

    assert deleted is True
    assert cp.deleted_threads == ["t1"]
    assert db.calls[0][1] == {"tid": "t1", "app_name": "common_agent", "user_id": "u1"}
    delete_params = next(params for sql, params in db.calls if "DELETE FROM agent_threads" in sql)
    assert delete_params == {"tid": "t1", "app_name": "common_agent", "user_id": "u1"}


def test_delete_thread_returns_false_when_scoped_metadata_missing(monkeypatch):
    db = _FakeDb(exists=False)
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)

    deleted = thread_service.delete_thread("t1", "common_agent", "u2")

    assert deleted is False
    assert not any("DELETE FROM agent_threads" in sql for sql, _ in db.calls)


def test_list_threads_orders_by_updated_at_desc(monkeypatch):
    db = _FakeDb()
    monkeypatch.setattr(thread_service, "SessionLocal", lambda: db)

    thread_service.list_threads("common_agent", "u1")

    sql, params = db.calls[0]
    assert "ORDER BY updated_at DESC" in sql
    assert "IS NULL" not in sql
    assert params == {"app_name": "common_agent", "user_id": "u1"}
