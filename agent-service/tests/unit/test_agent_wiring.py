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
