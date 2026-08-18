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

import google.auth
from a2a.server.tasks import InMemoryTaskStore
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.runners import Runner
from google.cloud import logging as google_cloud_logging

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
    from app.agent import root_agent

    runner = Runner(
        app=adk_app,
        session_service=services.get_session_service(),
        artifact_service=services.get_artifact_service(),
        auto_create_session=True,
    )
    app.state.runner = runner
    app.state.agent_app_name = adk_app.name
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
    configured_secret = os.environ.get("GAPSWISE_INTERNAL_API_SECRET", "").strip()
    if configured_secret and not hmac.compare_digest(
        configured_secret, x_gapswise_internal_secret or ""
    ):
        raise HTTPException(status_code=401, detail="Invalid internal service secret.")
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


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
