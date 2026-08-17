"""Central model and generation policy for the four ADK agent roles.

The current service still exposes one root ADK agent. Keeping the role policy
here means the future Context, Gap, Attention, and Partner sub-agents can be
introduced without scattering model names or generation settings through agent
modules. The cheap profile is the safe default; ``flagship`` is opt-in.
"""

from dataclasses import dataclass
from typing import Literal

from google.genai import types

AgentRole = Literal["context", "gap", "attention", "partner"]
ThinkingLevel = Literal["minimal", "low", "medium", "high"]
AgentModelProfile = Literal["cheap", "flagship"]

DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash-lite"


@dataclass(frozen=True)
class AgentModelConfig:
    role: AgentRole
    model: str
    thinking_level: ThinkingLevel
    max_output_tokens: int


_CHEAP_DEFAULTS: dict[AgentRole, AgentModelConfig] = {
    "context": AgentModelConfig("context", "gemini-2.5-flash-lite", "minimal", 1024),
    "gap": AgentModelConfig("gap", "gemini-2.5-flash", "low", 2048),
    "attention": AgentModelConfig("attention", "gemini-2.5-flash-lite", "minimal", 1024),
    "partner": AgentModelConfig("partner", "gemini-2.5-flash-lite", "low", 1024),
}

_FLAGSHIP_DEFAULTS: dict[AgentRole, AgentModelConfig] = {
    "context": _CHEAP_DEFAULTS["context"],
    "gap": AgentModelConfig("gap", "gemini-2.5-pro", "high", 4096),
    "attention": AgentModelConfig("attention", "gemini-2.5-flash-lite", "low", 1536),
    "partner": AgentModelConfig("partner", "gemini-2.5-flash", "medium", 2048),
}


def _env(name: str) -> str | None:
    import os

    value = os.environ.get(name, "").strip()
    return value or None


def _profile() -> AgentModelProfile:
    return "flagship" if (_env("AGENT_MODEL_PROFILE") or "").lower() == "flagship" else "cheap"


def _thinking_level(value: str | None, fallback: ThinkingLevel) -> ThinkingLevel:
    return value.lower() if value and value.lower() in {"minimal", "low", "medium", "high"} else fallback  # type: ignore[return-value]


def _max_output_tokens(value: str | None, fallback: int) -> int:
    try:
        parsed = int(value or "")
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


def get_agent_model_config(role: AgentRole) -> AgentModelConfig:
    """Resolve one role from profile defaults and independent env overrides."""
    defaults = (_FLAGSHIP_DEFAULTS if _profile() == "flagship" else _CHEAP_DEFAULTS)[role]
    prefix = f"AGENT_{role.upper()}"
    # GEMINI_MODEL remains a compatibility fallback for the current root agent;
    # role-specific variables always win and future sub-agents stay independent.
    legacy_model = _env("GEMINI_MODEL") if role == "partner" and _profile() == "cheap" else None
    return AgentModelConfig(
        role=role,
        model=_env(f"{prefix}_MODEL") or legacy_model or defaults.model,
        thinking_level=_thinking_level(
            _env(f"{prefix}_THINKING") or _env(f"{prefix}_THINKING_LEVEL"),
            defaults.thinking_level,
        ),
        max_output_tokens=_max_output_tokens(
            _env(f"{prefix}_MAX_OUTPUT_TOKENS"), defaults.max_output_tokens
        ),
    )


def get_agent_model_policy() -> dict[AgentRole, AgentModelConfig]:
    return {role: get_agent_model_config(role) for role in ("context", "gap", "attention", "partner")}


def generation_config_for(config: AgentModelConfig) -> types.GenerateContentConfig:
    """Translate policy settings into ADK's current Gemini generation config."""
    # The currently configured Flash-Lite endpoint rejects thinking_level. Keep
    # the requested level in the role policy for future sub-agents, but avoid
    # sending an unsupported field to the existing root agent.
    thinking_config = None if "flash-lite" in config.model.lower() else types.ThinkingConfig(
        thinking_level=types.ThinkingLevel(config.thinking_level.upper()),
    )
    return types.GenerateContentConfig(
        max_output_tokens=config.max_output_tokens,
        thinking_config=thinking_config,
    )
