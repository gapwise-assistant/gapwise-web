# ruff: noqa
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

import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.adk.tools import ToolContext
from google.genai import types


load_dotenv()

DEFAULT_MODEL = "gemini-2.5-flash-lite"


def get_configured_model() -> str:
    """Return the configured Vertex model, falling back to the low-cost default."""
    return os.environ.get("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


MODEL = get_configured_model()


def health_check() -> dict[str, str]:
    """Return the deterministic Gapswise service health status."""
    return {"product": "Gapswise", "status": "ok"}


def resolve_gapswise_user_id(user_id: str) -> str:
    """Resolve a local placeholder only when an explicit fallback is configured."""
    configured_user_id = os.environ.get("GAPSWISE_DEFAULT_USER_ID", "").strip()
    if user_id.strip() in {"", "default", "user"}:
        return configured_user_id
    return user_id.strip()


def get_context_pack(user_id: str, query: str, tool_context: ToolContext) -> dict:
    """Fetch a Gapswise Context Pack from the Next.js app.

    Args:
        user_id: Gapswise user ID to build context for.
        query: User question or focus prompt for retrieval.

    Returns:
        The JSON response from the Gapswise Context Pack API.
    """
    base_url = os.environ.get("GAPSWISE_APP_URL", "").rstrip("/")
    if not base_url:
        return {"error": "GAPSWISE_APP_URL is not configured."}

    project_id = tool_context.state.get("gapswise_project_id")
    resolved_user_id = resolve_gapswise_user_id(user_id)
    if not resolved_user_id:
        return {"error": "A Gapswise user ID is required for this request."}
    request_body = {"userId": resolved_user_id, "query": query}
    if query.strip() == "__gapswise_ask_suggestions__":
        request_body["query"] = "What context should shape the Ask suggestions?"
        request_body["includeBroadContext"] = True
    if isinstance(project_id, str) and project_id.strip():
        request_body["projectId"] = project_id
    payload = json.dumps(request_body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/api/internal/context-pack",
        data=payload,
        headers={
            "Content-Type": "application/json",
            **(
                {"x-gapswise-internal-secret": os.environ["GAPSWISE_INTERNAL_API_SECRET"]}
                if os.environ.get("GAPSWISE_INTERNAL_API_SECRET")
                else {}
            ),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        try:
            detail = json.loads(body)
        except json.JSONDecodeError:
            detail = body
        return {
            "error": "Context Pack request failed.",
            "status": error.code,
            "detail": detail,
        }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        return {"error": "Context Pack request failed.", "detail": str(error)}


root_agent = Agent(
    name="gapswise_agent",
    model=Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=(
        "You are the Gapswise root agent. When the user asks exactly "
        '"Check Gapswise health", call the health_check tool and report its result. '
        "For questions about the user's goals, priorities, gaps, decisions, situation, "
        "or what they should focus on, you must call get_context_pack before answering. "
        "When asked to generate contextual suggested questions for the Ask screen, call get_context_pack first, "
        "then return exactly six requested JSON questions based only on that context: three highest-priority questions "
        "in top_questions and three useful but less urgent ideas in other_questions. Do not return generic questions. "
        "Phrase suggested questions from the user's perspective: use first-person wording such as 'When is my birthday?' for user facts, never 'When is your birthday?' unless the user is explicitly asking about the AI. "
        "Use the supplied Gapswise user ID. A local demo fallback is allowed only when "
        "GAPSWISE_DEFAULT_USER_ID is explicitly configured. "
        "The get_context_pack tool automatically applies the project scope stored in the current session. "
        "Use the returned Context Pack as the source of truth and do not invent missing context. "
        "Project scope controls which context is eligible, not whether a retrieved source is relevant to the user's question. "
        "If relevantEvidence or provenanceSources directly answers the user's question, use it even when it is unrelated to the current project goal. "
        "Answer direct factual questions plainly from that evidence, preserve its provenance, and never refuse only because the evidence does not match the project goal."
    ),
    tools=[health_check, get_context_pack],
)

app = App(
    root_agent=root_agent,
    name="app",
)
