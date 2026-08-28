import json
from types import SimpleNamespace

from app import agent


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def test_context_pack_uses_authenticated_session_user(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse({"contextPack": {"activeGoals": [], "unresolvedGaps": []}})

    monkeypatch.setenv("GAPSWISE_APP_URL", "https://gapswise.example")
    monkeypatch.setenv("GAPSWISE_INTERNAL_API_SECRET", "test-secret")
    monkeypatch.setattr(agent.urllib.request, "urlopen", fake_urlopen)

    result = agent.get_context_pack(
        "default",
        "__gapswise_ask_suggestions__",
        SimpleNamespace(state={
            "gapswise_user_id": "firebase-user-123",
            "gapswise_project_id": "project-123",
        }),
    )

    assert result == {"contextPack": {"activeGoals": [], "unresolvedGaps": []}}
    assert json.loads(captured["request"].data) == {
        "userId": "firebase-user-123",
        "query": "What context should shape the Ask suggestions?",
        "includeBroadContext": True,
        "projectId": "project-123",
    }
    assert captured["request"].get_header("X-gapswise-internal-secret") == "test-secret"
    assert captured["timeout"] == 10


def test_web_research_and_routing_apps_use_registered_app_names() -> None:
    assert agent.web_research_app.name == "web_research"
    assert agent.web_research_agent.name != agent.web_research_app.name
    assert agent.routing_app.name == "ask_routing"
    assert agent.routing_agent.output_schema is agent.AskRouteDecision
    assert agent.routing_agent.generate_content_config.response_mime_type == "application/json"
    assert agent.google_search in agent.web_research_agent.tools


def test_routing_policy_uses_current_message_when_saved_context_is_sparse() -> None:
    instruction = agent.routing_agent.instruction.lower()

    assert "do not request clarification." in instruction
    assert "the current user message is always first-class context." in instruction
    assert "choose web_research only when" in instruction
    assert "reasoningmode focus" in instruction
    assert "reasoningmode impact" in instruction


def test_routing_schema_exposes_graph_reasoning_mode() -> None:
    schema = agent.AskRouteDecision.model_json_schema()

    assert "reasoningMode" in schema["properties"]


def test_partner_policy_keeps_sparse_project_discovery_concise() -> None:
    instruction = agent.root_agent.instruction.lower()

    assert "keep the response concise and conversational." in instruction
    assert "one high-value follow-up question." in instruction
    assert "do not turn early project discovery into a full plan." in instruction
    assert "your exploration and recommendations are conversational output" in instruction
