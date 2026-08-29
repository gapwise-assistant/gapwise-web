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

# Lowest-cost Gemini model verified in Vertex AI for gapwise-505217/global.
DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite"
MINIMUM_GEMINI_MAJOR = 3
MINIMUM_GEMINI_MINOR = 5


@dataclass(frozen=True)
class AgentModelConfig:
    role: AgentRole
    model: str
    thinking_level: ThinkingLevel
    max_output_tokens: int


@dataclass(frozen=True)
class GapEscalationPolicy:
    enabled: bool
    max_retries: int
    close_candidate_margin: float
    low_confidence_threshold: float
    high_impact_threshold: float
    complex_path_threshold: int


_CHEAP_DEFAULTS: dict[AgentRole, AgentModelConfig] = {
    "context": AgentModelConfig("context", "gemini-3.5-flash-lite", "minimal", 1024),
    "gap": AgentModelConfig("gap", "gemini-3.5-flash-lite", "low", 2048),
    "attention": AgentModelConfig("attention", "gemini-3.5-flash-lite", "minimal", 1024),
    "partner": AgentModelConfig("partner", "gemini-3.5-flash-lite", "low", 1024),
}

_FLAGSHIP_DEFAULTS: dict[AgentRole, AgentModelConfig] = {
    "context": _CHEAP_DEFAULTS["context"],
    "gap": AgentModelConfig("gap", "gemini-3.5-flash", "high", 4096),
    "attention": AgentModelConfig("attention", "gemini-3.5-flash-lite", "low", 1536),
    "partner": AgentModelConfig("partner", "gemini-3.5-flash", "medium", 2048),
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


def _bool(value: str | None, fallback: bool) -> bool:
    if value is None:
        return fallback
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    return fallback


def _float(value: str | None, fallback: float, minimum: float = 0.0) -> float:
    try:
        parsed = float(value or "")
    except ValueError:
        return fallback
    return parsed if parsed >= minimum else fallback


def is_demo_mode() -> bool:
    return (_env("GAPSWISE_DEMO_MODE") or "").lower() == "true"


def is_eligible_gemini_model(model: str) -> bool:
    """Return whether a model identifier is Gemini 3.5 or newer."""
    import re

    match = re.search(r"(?:^|/)gemini-(\d+)\.(\d+)(?:[-/]|$)", model.strip(), re.IGNORECASE)
    if not match:
        return False
    major, minor = int(match.group(1)), int(match.group(2))
    return major > MINIMUM_GEMINI_MAJOR or (
        major == MINIMUM_GEMINI_MAJOR and minor >= MINIMUM_GEMINI_MINOR
    )


def validate_live_model(model: str) -> str:
    normalized = model.strip()
    if not is_demo_mode() and not is_eligible_gemini_model(normalized):
        raise RuntimeError(
            "Live ADK requires Gemini 3.5 or newer; "
            f'the configured model "{normalized or "(empty)"}" is not eligible. '
            "Set GEMINI_MODEL or the applicable AGENT_*_MODEL override to gemini-3.5-flash-lite or newer."
        )
    return normalized


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


def get_public_demo_model_config() -> AgentModelConfig:
    """Return the fixed public-demo Partner boundary.

    Public access must not inherit a larger output budget from a caller or
    from the normal Partner response configuration. The model itself remains
    the configured Partner model, while the public boundary always uses low
    thinking and 512 output tokens.
    """
    partner = get_agent_model_config("partner")
    return AgentModelConfig(
        role="partner",
        model=partner.model,
        thinking_level="low",
        max_output_tokens=512,
    )


def get_agent_model_policy() -> dict[AgentRole, AgentModelConfig]:
    return {role: get_agent_model_config(role) for role in ("context", "gap", "attention", "partner")}


def get_gap_escalation_policy() -> GapEscalationPolicy:
    """Resolve conservative, opt-in Gap Agent escalation controls."""
    import math

    return GapEscalationPolicy(
        enabled=_bool(_env("AGENT_GAP_ESCALATION_ENABLED"), False),
        max_retries=min(2, max(0, int(_float(_env("AGENT_GAP_ESCALATION_MAX_RETRIES"), 1)))),
        close_candidate_margin=_float(_env("AGENT_GAP_ESCALATION_MARGIN"), 0.05),
        low_confidence_threshold=_float(_env("AGENT_GAP_ESCALATION_LOW_CONFIDENCE"), 0.45),
        high_impact_threshold=_float(_env("AGENT_GAP_ESCALATION_HIGH_IMPACT"), 0.9),
        complex_path_threshold=max(1, math.floor(_float(_env("AGENT_GAP_ESCALATION_COMPLEXITY"), 2, 1))),
    )


def get_gap_escalation_model_config() -> AgentModelConfig:
    """Return the stronger Gap configuration reserved for an escalation retry."""
    flagship = _FLAGSHIP_DEFAULTS["gap"]
    return AgentModelConfig(
        role="gap",
        model=_env("AGENT_GAP_ESCALATION_MODEL") or flagship.model,
        thinking_level=_thinking_level(_env("AGENT_GAP_ESCALATION_THINKING"), "high"),
        max_output_tokens=_max_output_tokens(_env("AGENT_GAP_ESCALATION_MAX_OUTPUT_TOKENS"), flagship.max_output_tokens),
    )


def validate_live_model_policy() -> dict[AgentRole, AgentModelConfig]:
    """Validate all role models before a real ADK process accepts traffic."""
    policy = get_agent_model_policy()
    if not is_demo_mode():
        for config in policy.values():
            validate_live_model(config.model)
    return policy


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
