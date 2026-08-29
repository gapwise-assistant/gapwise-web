from types import SimpleNamespace

import pytest

from app import agent, fast_api_app
from app.app_utils import services


class FakeSession:
    id = "session-1"


class FakeSessionService:
    def __init__(self) -> None:
        self.created: dict[str, object] = {}

    async def create_session(self, **kwargs):
        self.created = kwargs
        return FakeSession()


class FakeEvent:
    def model_dump(self, **kwargs):
        return {"content": {"parts": [{"text": "ok"}]}}


class FakeRunner:
    def __init__(self) -> None:
        self.run_args: dict[str, object] = {}

    async def run_async(self, **kwargs):
        self.run_args = kwargs
        yield FakeEvent()


@pytest.mark.asyncio
async def test_private_runner_binds_session_to_the_registered_app(monkeypatch) -> None:
    session_service = FakeSessionService()
    runner = FakeRunner()
    monkeypatch.setattr(services, "get_session_service", lambda: session_service)

    session_id, events = await fast_api_app._run_private_agent(
        runner,
        agent.web_research_app.name,
        "demo-user",
        "What is the MiniDV format?",
    )

    assert session_id == "session-1"
    assert events == [{"content": {"parts": [{"text": "ok"}]}}]
    assert session_service.created["app_name"] == "web_research"
    assert runner.run_args["session_id"] == "session-1"


@pytest.mark.asyncio
async def test_ask_router_omits_optional_null_reasoning_mode(monkeypatch) -> None:
    async def fake_run_private_agent(*args, **kwargs):
        return "routing-session", [{
            "content": {
                "parts": [{
                    "text": '{"route":"web_research","reason":"Search was requested.","reasoningMode":null}',
                }],
            },
        }]

    monkeypatch.setattr(fast_api_app, "_run_private_agent", fake_run_private_agent)
    monkeypatch.setattr(fast_api_app, "is_demo_mode", lambda: False)
    monkeypatch.setenv("GAPSWISE_INTERNAL_API_SECRET", "")

    http_request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(
            routing_runner=object(),
            routing_app_name="ask_routing",
        )),
    )
    result = await fast_api_app.route_ask(
        fast_api_app.AskRouteRequest(user_id="demo-user", message="Search online."),
        http_request,
        None,
    )

    assert result == {
        "route": "web_research",
        "reason": "Search was requested.",
    }
