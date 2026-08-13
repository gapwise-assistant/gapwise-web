# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
You can add your unit tests here.
This is where you test your business logic, including agent functionality,
data processing, and other core components of your application.
"""

import json
import urllib.error

from app.agent import (
    DEFAULT_MODEL,
    MODEL,
    get_configured_model,
    get_context_pack,
    health_check,
    resolve_gapswise_user_id,
    root_agent,
)


class FakeToolContext:
    def __init__(self, state=None):
        self.state = state or {}


def test_health_check() -> None:
    """The health tool returns the stable Gapswise status payload."""
    assert health_check() == {"product": "Gapswise", "status": "ok"}


def test_agent_uses_configured_low_cost_model(monkeypatch) -> None:
    """The ADK model is configurable and has a low-cost cloud default."""
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-model")
    assert get_configured_model() == "gemini-test-model"

    monkeypatch.setenv("GEMINI_MODEL", "  ")
    assert get_configured_model() == DEFAULT_MODEL
    assert MODEL == DEFAULT_MODEL
    assert root_agent.model.model == MODEL


def test_get_context_pack_posts_to_next_endpoint(monkeypatch) -> None:
    """The Context Pack tool delegates retrieval to the Next.js endpoint."""
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self) -> bytes:
            return json.dumps(
                {
                    "contextPack": {
                        "query": "What am I neglecting?",
                        "includedContextIds": ["node_goal"],
                    }
                }
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["headers"] = dict(request.header_items())
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setenv("GAPSWISE_APP_URL", "http://localhost:3000")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    result = get_context_pack("demo-user", "What am I neglecting?", FakeToolContext())

    assert captured == {
        "url": "http://localhost:3000/api/internal/context-pack",
        "timeout": 10,
        "headers": {"Content-type": "application/json"},
        "body": {"userId": "demo-user", "query": "What am I neglecting?"},
    }
    assert result["contextPack"]["includedContextIds"] == ["node_goal"]


def test_get_context_pack_maps_adk_default_user_to_demo_user(monkeypatch) -> None:
    """The ADK dev UI placeholder user resolves to the Gapswise demo user."""
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self) -> bytes:
            return json.dumps({"contextPack": {"relevantEvidence": []}}).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setenv("GAPSWISE_APP_URL", "http://localhost:3000")
    monkeypatch.setenv("GAPSWISE_DEFAULT_USER_ID", "demo-user")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    get_context_pack(
        "default",
        "What does my latest PDF say I am trying to verify?",
        FakeToolContext(),
    )

    assert captured["body"] == {
        "userId": "demo-user",
        "query": "What does my latest PDF say I am trying to verify?",
    }


def test_resolve_gapswise_user_id_preserves_explicit_users(monkeypatch) -> None:
    """Explicit Gapswise user IDs still pass through unchanged."""
    monkeypatch.setenv("GAPSWISE_DEFAULT_USER_ID", "demo-user")

    assert resolve_gapswise_user_id("demo-user-1") == "demo-user-1"
    assert resolve_gapswise_user_id("default") == "demo-user"


def test_get_context_pack_applies_project_scope_from_session(monkeypatch) -> None:
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self) -> bytes:
            return b'{"contextPack":{"relevantEvidence":[]}}'

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setenv("GAPSWISE_APP_URL", "http://localhost:3000")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    get_context_pack(
        "demo-user",
        "What should I focus on?",
        FakeToolContext({"gapswise_project_id": "project_hackathon"}),
    )

    assert captured["body"] == {
        "userId": "demo-user",
        "query": "What should I focus on?",
        "projectId": "project_hackathon",
    }


def test_get_context_pack_enables_broad_context_for_ask_suggestions(
    monkeypatch,
) -> None:
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self) -> bytes:
            return b'{"contextPack":{"relevantEvidence":[]}}'

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse()

    monkeypatch.setenv("GAPSWISE_APP_URL", "http://localhost:3000")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    get_context_pack(
        "demo-user",
        "__gapswise_ask_suggestions__",
        FakeToolContext({"gapswise_project_id": "project_japan"}),
    )

    assert captured["body"] == {
        "userId": "demo-user",
        "query": "What context should shape the Ask suggestions?",
        "projectId": "project_japan",
        "includeBroadContext": True,
    }


def test_get_context_pack_returns_http_errors(monkeypatch) -> None:
    """HTTP failures are returned as tool data instead of raising."""

    class FakeBody:
        def read(self) -> bytes:
            return b'{"error":"Invalid context pack request."}'

        def close(self) -> None:
            return None

    def fake_urlopen(request, timeout):
        raise urllib.error.HTTPError(
            request.full_url,
            400,
            "Bad Request",
            {},
            fp=FakeBody(),
        )

    monkeypatch.setenv("GAPSWISE_APP_URL", "http://localhost:3000")
    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    result = get_context_pack("demo-user", "", FakeToolContext())

    assert result == {
        "error": "Context Pack request failed.",
        "status": 400,
        "detail": {"error": "Invalid context pack request."},
    }


def test_root_agent_keeps_health_tool_and_adds_context_pack_tool() -> None:
    """The root agent exposes both required deterministic tools."""
    tool_names = {tool.__name__ for tool in root_agent.tools}
    instruction = root_agent.instruction

    assert {"health_check", "get_context_pack"}.issubset(tool_names)
    assert isinstance(instruction, str)
    assert "must call get_context_pack before answering" in instruction
    assert "three highest-priority questions" in instruction
    assert "top_questions" in instruction
    assert "other_questions" in instruction
    assert 'Use user_id "demo-user"' in instruction
    assert "directly answers the user's question" in instruction
    assert "never refuse only because the evidence does not match the project goal" in instruction
