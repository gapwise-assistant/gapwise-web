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
import logging
import os
import urllib.error
import urllib.request
from typing import Literal

from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.adk.tools import ToolContext
from google.adk.tools import google_search
from google.genai import types
from pydantic import BaseModel, Field
from app.model_policy import (
    DEFAULT_FALLBACK_MODEL,
    generation_config_for,
    get_agent_model_config,
    get_public_demo_model_config,
    validate_live_model,
)


load_dotenv()
logger = logging.getLogger(__name__)

DEFAULT_MODEL = DEFAULT_FALLBACK_MODEL


def get_configured_model() -> str:
    """Return the configured Vertex model, rejecting legacy live selections."""
    return validate_live_model(get_agent_model_config("partner").model)


MODEL = get_configured_model()
MODEL_CONFIG = get_agent_model_config("partner")
PUBLIC_DEMO_MODEL_CONFIG = get_public_demo_model_config()


class AskRouteDecision(BaseModel):
    """Structured route selected before the Partner Agent is invoked."""

    route: Literal["internal_context", "web_research", "graph_reasoning"] = Field(
        description="The route the application should execute for this request."
    )
    reason: str = Field(
        description=(
            "Short internal explanation for the selected route. "
            "Never intended for the end user."
        )
    )
    reasoningMode: Literal["factual", "reasoning", "impact", "decision", "focus"] | None = Field(
        default=None,
        description="Graph retrieval mode. Required when route is graph_reasoning.",
    )


class AskContextProposal(BaseModel):
    """AI-derived project state held for explicit user confirmation."""

    type: Literal[
        "GOAL",
        "KNOWN",
        "CONSTRAINT",
        "ASSUMPTION",
        "DECISION",
        "UNKNOWN",
        "EVIDENCE",
        "EXPERIMENT",
        "RISK",
        "NEXT_ACTION",
        "PREFERENCE",
    ]
    text: str = Field(min_length=1, max_length=1200)
    reasoning: str | None = Field(default=None, max_length=1200)
    targetNodeId: str | None = Field(
        default=None,
        description=(
            "Existing canonical project node represented by this proposal. "
            "Use only an ID supplied in the Context Pack."
        ),
    )
    status: Literal["OPEN", "RESOLVED", "DEFERRED"]


class AskResponse(BaseModel):
    """Structured metadata returned with a normal Partner Agent response."""

    answer: str = Field(description="The complete conversational response for the user.")
    outcome: Literal["exploration", "recommendation", "conclusion"] = Field(
        description="Whether the response is discovery, directional advice, or a durable conclusion."
    )
    resolvesQuestionId: str | None = Field(
        default=None,
        description="The ID of the one existing open question directly answered by a conclusion.",
    )
    conclusion: str | None = Field(
        default=None,
        description="Only for a conclusion: the concise answer itself, without reasoning or follow-up questions.",
    )
    contextProposals: list[AskContextProposal] = Field(
        default_factory=list,
        max_length=3,
        description=(
            "AI-derived project updates that are useful to track but must remain pending "
            "until the user explicitly chooses Add."
        ),
    )


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
    chat_id = tool_context.state.get("gapswise_chat_id")
    session_user_id = tool_context.state.get("gapswise_user_id")
    resolved_user_id = (
        session_user_id.strip()
        if isinstance(session_user_id, str) and session_user_id.strip()
        else resolve_gapswise_user_id(user_id)
    )
    if not resolved_user_id:
        return {"error": "A Gapswise user ID is required for this request."}
    request_body = {"userId": resolved_user_id, "query": query}
    if query.strip() == "__gapswise_ask_suggestions__":
        request_body["query"] = "What context should shape the Ask suggestions?"
        request_body["includeBroadContext"] = True
    if isinstance(project_id, str) and project_id.strip():
        request_body["projectId"] = project_id
    if isinstance(chat_id, str) and chat_id.strip():
        request_body["chatId"] = chat_id
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
            result = json.loads(response.read().decode("utf-8"))
            context_pack = result.get("contextPack") if isinstance(result, dict) else None
            if isinstance(context_pack, dict):
                logger.info(
                    "Context Pack loaded for Ask: project_scope=%s active_goals=%d unresolved_gaps=%d evidence=%d provenance=%d",
                    bool(project_id),
                    len(context_pack.get("activeGoals", [])),
                    len(context_pack.get("unresolvedGaps", [])),
                    len(context_pack.get("relevantEvidence", [])),
                    len(context_pack.get("provenanceSources", [])),
                )
            else:
                logger.warning(
                    "Context Pack returned an unexpected shape for Ask: project_scope=%s",
                    bool(project_id),
                )
            return result
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8")
        try:
            detail = json.loads(body)
        except json.JSONDecodeError:
            detail = body
        logger.error(
            "Context Pack request failed for Ask: status=%s project_scope=%s",
            error.code,
            bool(project_id),
        )
        return {
            "error": "Context Pack request failed.",
            "status": error.code,
            "detail": detail,
        }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        logger.error(
            "Context Pack request failed for Ask: error=%s project_scope=%s",
            type(error).__name__,
            bool(project_id),
        )
        return {"error": "Context Pack request failed.", "detail": str(error)}


web_research_agent = Agent(
    name="gapswise_web_research_agent",
    model=Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    generate_content_config=generation_config_for(MODEL_CONFIG),
    instruction=(
        "You are the Gapswise web research agent. Use the built-in google_search tool "
        "for every request to search the live web and retrieve external or current information. "
        "Return a concise, accurate answer grounded strictly in the Google Search results. "
        "Preserve source-supported claims and citations. "
        "Do not invent URLs or citations. Do not answer from unverified model memory. "
        "If Google Search fails or provides no grounding, say that external verification failed."
    ),
    tools=[google_search],
)


routing_agent = Agent(
    name="gapswise_ask_router",
    model=Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    generate_content_config=generation_config_for(MODEL_CONFIG).model_copy(
        update={"response_mime_type": "application/json", "temperature": 0}
    ),
    output_schema=AskRouteDecision,
    instruction=(
        "You are the Gapswise Ask routing agent. "
        "Your only job is to choose whether the user's message should be handled "
        "using internal/project context or live web research. "
        "The current user message is always first-class context. "
        "It may introduce a project, goal, preference, constraint, idea, "
        "uncertainty, decision, problem, or fact. "
        "Choose internal_context for ordinary conversations about the user's project, "
        "goals, plans, ideas, uncertainty, or simple factual questions. "
        "Choose graph_reasoning when the user asks about relationships among "
        "multiple project facts, dependencies, blockers, downstream impact, "
        "consequences, conflicts, tradeoffs, prerequisite chains, or what "
        "would change if a project condition changes. This route still uses "
        "the Partner Agent, but tells the application to provide a bounded "
        "canonical graph slice in addition to the normal Context Pack. "
        "When a tradeoff or recommendation requires tracing relationships "
        "among multiple project nodes, choose graph_reasoning even though it "
        "is also a project conversation. "
        "Do not choose graph_reasoning for a simple fact lookup, summary, "
        "ordinary conversation, or a generic request to explain the assistant's "
        "previous recommendation. "
        "For questions asking what to focus on, prioritize, do first, address next, "
        "or what matters most, choose graph_reasoning with reasoningMode focus. "
        "For consequences, downstream effects, impact, or what changes if a condition "
        "changes, choose graph_reasoning with reasoningMode impact. "
        "For choosing among options or project tradeoffs, choose graph_reasoning with "
        "reasoningMode decision when graph relationships are needed. Use reasoningMode "
        "reasoning for other relationship questions. "
        "When route is not graph_reasoning, omit reasoningMode. "
        "Choose web_research only when the request requires current or external "
        "information that should be verified outside Gapswise, or when the user "
        "explicitly asks to search, check, verify, or research online. "
        "Do not decide whether enough information exists to answer. "
        "Do not request clarification. "
        "Do not answer the user's question. "
        "Do not invent facts. "
        "If more personal or project information would improve the answer, "
        "still choose internal_context. The Partner Agent is responsible for "
        "asking a useful follow-up question when appropriate. "
        "The reason field is internal metadata only. Keep it short."
    ),
)


root_agent = Agent(
    name="gapswise_agent",
    model=Gemini(
        model=MODEL,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    generate_content_config=generation_config_for(MODEL_CONFIG),
    instruction=(
        "You are the Gapswise root agent. When the user asks exactly "
        '"Check Gapswise health", call the health_check tool and report its result. '
        "For questions about the user's goals, priorities, gaps, decisions, situation, "
        "or what they should focus on, you must call get_context_pack before answering, unless the message starts with "
        "'PRELOADED GAPWISE CONTEXT PACK'. In that case, the app already retrieved the exact project-scoped pack for "
        "the original question; use it directly and do not call get_context_pack again for that turn. "
        "When asked to generate contextual suggested questions for the Ask screen, call get_context_pack first, "
        "then return exactly six requested JSON questions based only on that context: three highest-priority questions "
        "in top_questions and three useful but less urgent ideas in other_questions. Do not return generic questions. "
        "A sparse Context Pack or a pack with no exact phrase match is still a valid result, not an error. "
        "If any goals, gaps, evidence, decisions, preferences, or commitments are returned, use those details. "
        "If every collection is empty, return cautious questions about the most important missing information for the current scope. "
        "Never refuse, say that the Context Pack is empty, claim lack of access, or return an explanation instead of the requested JSON. "
        "For the internal Ask suggestions request, follow its explicit top_questions and other_questions JSON contract instead of this normal response contract. "
        "For every other conversational Ask response, return only valid JSON with answer, outcome, and contextProposals fields. "
        "The outcome must be exploration, recommendation, or conclusion. Use exploration when continuing discovery, asking a follow-up, discussing possibilities, "
        "or when there is not enough basis for a durable conclusion. Use recommendation for directional advice that should not yet resolve a project question. "
        "Use conclusion only when the conversation supports a clear, durable conclusion that directly answers one existing open project question. "
        "Only a conclusion may include resolvesQuestionId and conclusion; omit both fields for exploration and recommendation. "
        "The conclusion field must contain only the concise conclusion itself, without reasoning, citations, follow-up questions, or the full response. "
        "Never mark a response as conclusion merely because it discusses an open question. "
        "AI reasoning must not silently become project truth. Clear project facts explicitly stated by the user are handled by Context ingestion. "
        "Use contextProposals only for valuable project state you derived rather than facts the user stated. "
        "When a proposal restates, refines, or advances an existing project node, set targetNodeId to that supplied canonical node ID. "
        "Never invent a targetNodeId, and do not create a parallel proposal for project state already marked RESOLVED. "
        "A contextProposal may be an inferred risk, assumption, unresolved external question, or decision implication, but it is only a suggestion until the user chooses Add. "
        "Do not propose hypothetical outcomes, unsupported blockers, ordinary recommendations, or every follow-up question. Return an empty contextProposals array when there is no derived state worth tracking. "
        "Each contextProposal must be one atomic concept with type, text, optional reasoning, and status OPEN, RESOLVED, or DEFERRED. The application will show Add and Dismiss; never claim a proposal was saved. "
        "When contextProposals is non-empty, answer the user normally and explain the reasoning, but do not ask for confirmation in the prose. Never end with or include a question asking whether the user wants to track, add, save, record, or formalize the proposal; the UI provides those controls. "
        "Keep inferred claims conditional: use if, when, could, or may for outcomes not established by project context. Do not introduce unsupported business facts or state an inferred causal claim as certain. "
        "Treat project decision status as authoritative. An OPEN decision remains unresolved even when preferences, "
        "evidence, survey results, recommendations, or other information strongly favor one option. Do not describe "
        "an OPEN decision as chosen, settled, locked in, finalized, or resolved. Only treat a decision as resolved "
        "when project context explicitly marks it RESOLVED or records a clear user commitment. "
        "Your exploration and recommendations are conversational output, not user-confirmed project truth. Do not present them as facts to be ingested into the project graph. "
        "When project context is sparse, do not prematurely design the entire solution. "
        "Prefer progressive discovery: first reflect the most important thing already understood; "
        "then identify the main tension, decision, or uncertainty; give a small initial perspective when useful; "
        "and ask one high-value question that will materially improve the next recommendation. "
        "Do not invent precise numbers, schedules, operational requirements, or best practices unless they are supported "
        "by the supplied context or external research. Treat early conversation as project discovery, not as an opportunity "
        "to produce a complete plan. Avoid lists of generic follow-up questions; ask the single question with the highest "
        "expected value. Clearly distinguish what the user said, what you infer, and what you suggest. "
        "Do not imply unsupported recommendations are established facts. "
        "For ordinary project-context responses, do not add inline numeric source or citation markers; source details are "
        "shown separately by the application. "
        "When project context is sparse, keep the response concise and conversational. "
        "Do not restate the user's message at length. Do not repeat the same recommendation or question in multiple sections. "
        "Prefer one short synthesis of what matters, one useful initial perspective, and one high-value follow-up question. "
        "Avoid precise recommendations such as exact attendee counts, schedules, budgets, or operating assumptions unless they "
        "are supported by project context or external evidence. Do not turn early project discovery into a full plan. "
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


public_demo_agent = Agent(
    name="gapswise_public_demo_partner",
    model=Gemini(
        model=PUBLIC_DEMO_MODEL_CONFIG.model,
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    generate_content_config=generation_config_for(PUBLIC_DEMO_MODEL_CONFIG),
    output_schema=AskResponse,
    instruction=(
        "You are the public Gapwise demo Partner Agent. Answer only from the "
        "preloaded workspace context and the user's current message. Never use "
        "web search, routing, tools, project mutation, or context ingestion. "
        "Return the required structured AskResponse. Keep the response concise "
        "and conversational. Use exploration for discovery or a follow-up, "
        "recommendation for directional advice, and conclusion only when a clear "
        "answer resolves one supplied open question. Always return an empty "
        "contextProposals array because public demo responses cannot mutate the "
        "workspace."
    ),
)

app = App(
    root_agent=root_agent,
    name="app",
)

web_research_app = App(
    root_agent=web_research_agent,
    name="web_research",
)

routing_app = App(
    root_agent=routing_agent,
    name="ask_routing",
)

public_demo_app = App(
    root_agent=public_demo_agent,
    name="public_demo",
)
