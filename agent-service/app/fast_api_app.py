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

import contextlib
import hmac
import logging
import os
from collections.abc import AsyncIterator
from typing import Any

import google.auth
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner
from google.cloud import logging as google_cloud_logging
from google.genai import types
from pydantic import BaseModel, Field

from app.app_utils import services
from app.app_utils.a2a import attach_a2a_routes
from app.app_utils.typing import Feedback
from app.gap_contract import GapAssessmentRequest, GapAssessmentResponse
from app.gap_runtime import GapRuntimeError, run_gap_assessment
from app.model_policy import is_demo_mode

load_dotenv()
# Never export prompt/response bodies to ADK spans. Sanitized application
# metadata is recorded explicitly below instead.
os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"] = "false"
_, project_id = google.auth.default()
logging_client = google_cloud_logging.Client()
logger = logging_client.logger(__name__)
startup_logger = logging.getLogger(__name__)
allow_origins = (
    os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else None
)

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class WebResearchRequest(BaseModel):
    user_id: str = Field(min_length=1)
    message: str = Field(min_length=1)


class AskRouteRequest(BaseModel):
    user_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    trusted_context: dict[str, Any] = Field(default_factory=dict)


def _check_internal_secret(value: str | None) -> None:
    configured_secret = os.environ.get("GAPSWISE_INTERNAL_API_SECRET", "").strip()
    if configured_secret and not hmac.compare_digest(configured_secret, value or ""):
        raise HTTPException(status_code=401, detail="Invalid internal service secret.")


async def _run_private_agent(
    runner: Runner,
    app_name: str,
    user_id: str,
    message: str,
    state: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    session_service = services.get_session_service()
    session = await session_service.create_session(
        app_name=app_name,
        user_id=user_id,
        state=state,
    )
    events: list[dict[str, Any]] = []
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text=message)],
        ),
    ):
        events.append(event.model_dump(mode="json", exclude_none=True))
    return session.id, events


def _event_texts(events: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for event in events:
        content = event.get("content")
        if not isinstance(content, dict):
            continue
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue
        texts.extend(
            part["text"]
            for part in parts
            if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip()
        )
    return texts


def _route_from_events(events: list[dict[str, Any]]):
    from app.agent import AskRouteDecision

    for text in reversed(_event_texts(events)):
        candidate = text.strip()
        if candidate.startswith("```"):
            candidate = candidate.strip("`").strip()
            if candidate.startswith("json"):
                candidate = candidate[4:].strip()
        try:
            return AskRouteDecision.model_validate_json(candidate)
        except ValueError:
            continue
    raise RuntimeError("The routing agent returned no structured route decision.")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if is_demo_mode():
        raise RuntimeError(
            "ADK is disabled while GAPSWISE_DEMO_MODE=true; use the deterministic local demo adapter."
        )
    from app.model_policy import validate_live_model_policy

    policy = validate_live_model_policy()
    policy_summary = {role: config.model for role, config in policy.items()}
    startup_logger.info("Live ADK model policy validated: %s", policy_summary)
    # The model identifiers are safe developer metadata; do not log prompts,
    # Context Packs, credentials, or model output.
    logger.log_struct(
        {"event": "live_model_policy_validated", "models": policy_summary},
        severity="INFO",
    )
    from app.agent import app as adk_app
    from app.agent import root_agent, routing_app, web_research_app

    session_service = services.get_session_service()
    artifact_service = services.get_artifact_service()
    runner = Runner(
        app=adk_app,
        session_service=session_service,
        artifact_service=artifact_service,
        auto_create_session=True,
    )
    web_research_runner = Runner(
        app=web_research_app,
        session_service=session_service,
        artifact_service=artifact_service,
        auto_create_session=True,
    )
    routing_runner = Runner(
        app=routing_app,
        session_service=session_service,
        artifact_service=artifact_service,
        auto_create_session=True,
    )
    app.state.runner = runner
    app.state.agent_app_name = adk_app.name
    app.state.web_research_runner = web_research_runner
    app.state.web_research_app_name = web_research_app.name
    app.state.routing_runner = routing_runner
    app.state.routing_app_name = routing_app.name
    await attach_a2a_routes(
        app,
        agent=root_agent,
        runner=runner,
        task_store=InMemoryTaskStore(),
        rpc_path=f"/a2a/{adk_app.name}",
    )
    yield


app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=services.ARTIFACT_SERVICE_URI,
    allow_origins=allow_origins,
    session_service_uri=services.SESSION_SERVICE_URI,
    otel_to_cloud=True,
    lifespan=lifespan,
)
app.title = "agent-service"
app.description = "API for interacting with the Agent agent-service"


@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    """Collect and log feedback.

    Args:
        feedback: The feedback data to log

    Returns:
        Success message
    """
    logger.log_struct(feedback.model_dump(), severity="INFO")
    return {"status": "success"}


@app.post("/internal/gap-assess", response_model=GapAssessmentResponse)
async def assess_gap(
    request: GapAssessmentRequest,
    x_gapswise_internal_secret: str | None = Header(default=None),
) -> GapAssessmentResponse:
    """Run the scoped structured Gap Agent without exposing prompt content."""
    _check_internal_secret(x_gapswise_internal_secret)
    if is_demo_mode():
        raise HTTPException(
            status_code=503,
            detail="Gap Agent is disabled in deterministic demo mode.",
        )
    try:
        response = await run_gap_assessment(request)
    except GapRuntimeError as error:
        startup_logger.warning("Gap Agent request failed safely: %s", error)
        raise HTTPException(status_code=502, detail=str(error)) from error

    # Safe metadata only. Prompts, graph text, Context Packs, credentials, and
    # model output are deliberately excluded from logs.
    logger.log_struct(
        {
            "event": "gap_agent_completed",
            **response.metadata.model_dump(),
            "projectId": request.project.id,
        },
        severity="INFO",
    )
    return response


@app.post("/internal/web-research")
async def run_web_research(
    request: WebResearchRequest,
    http_request: Request,
    x_gapswise_internal_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    """Run the web research agent through its own registered ADK application."""
    _check_internal_secret(x_gapswise_internal_secret)
    if is_demo_mode():
        raise HTTPException(
            status_code=503,
            detail="External verification failed: web research is disabled in demo mode.",
        )
    runner = getattr(http_request.app.state, "web_research_runner", None)
    if runner is None:
        raise HTTPException(status_code=503, detail="External verification failed: web research is unavailable.")
    try:
        session_id, events = await _run_private_agent(
            runner,
            http_request.app.state.web_research_app_name,
            request.user_id,
            request.message,
        )
    except Exception as error:
        startup_logger.warning("Web research agent failed safely: %s", type(error).__name__)
        raise HTTPException(
            status_code=502,
            detail="External verification failed: web research could not be completed.",
        ) from error
    return {"sessionId": session_id, "events": events}


@app.post("/internal/ask-route")
async def route_ask(
    request: AskRouteRequest,
    http_request: Request,
    x_gapswise_internal_secret: str | None = Header(default=None),
) -> dict[str, str]:
    """Classify an Ask request before the Partner Agent is allowed to run."""
    _check_internal_secret(x_gapswise_internal_secret)
    if is_demo_mode():
        raise HTTPException(status_code=503, detail="Ask routing is disabled in demo mode.")
    runner = getattr(http_request.app.state, "routing_runner", None)
    if runner is None:
        raise HTTPException(status_code=503, detail="Ask routing is unavailable.")
    prompt = (
        "Classify this request according to your routing policy. Return only the structured output.\n\n"
        "The current user message is first-class context and may itself contain the project goal, "
        "preferences, constraints, unresolved decisions, or facts needed for a useful response. "
        "Do not treat an empty or sparse saved context as proof that the user has provided no context.\n\n"
        f"Current user message:\n{request.message}\n\n"
        f"Saved trusted context supplied by Gapwise (may be empty):\n{request.trusted_context}\n\n"
        "Use both inputs. Choose internal_context when the current message contains useful project material "
        "that the Partner Agent can analyze or use to ask one focused follow-up question. "
        "Choose graph_reasoning when the question requires reasoning across multiple canonical project "
        "nodes or persisted relationships, including consequences, downstream impact, blockers, "
        "dependencies, conflicts, tradeoffs, or prerequisite chains. Do not choose it for simple "
        "fact lookups, summaries, ordinary conversation, or generic explanations of a prior answer. "
        "If a tradeoff requires tracing relationships among multiple project nodes, prefer graph_reasoning "
        "over internal_context. "
        "Choose web_research only when current or external information must be verified outside Gapswise."
    )
    try:
        _, events = await _run_private_agent(
            runner,
            http_request.app.state.routing_app_name,
            request.user_id,
            prompt,
        )
        decision = _route_from_events(events)
    except Exception as error:
        startup_logger.warning("Ask routing agent failed safely: %s", type(error).__name__)
        raise HTTPException(status_code=502, detail="Ask routing could not produce a valid decision.") from error
    return decision.model_dump()


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
