from app.model_policy import get_agent_model_config, get_agent_model_policy


def test_cheap_profile_is_the_default(monkeypatch) -> None:
    monkeypatch.delenv("AGENT_MODEL_PROFILE", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    for role in ("CONTEXT", "GAP", "ATTENTION", "PARTNER"):
        monkeypatch.delenv(f"AGENT_{role}_MODEL", raising=False)
        monkeypatch.delenv(f"AGENT_{role}_THINKING", raising=False)
        monkeypatch.delenv(f"AGENT_{role}_THINKING_LEVEL", raising=False)
        monkeypatch.delenv(f"AGENT_{role}_MAX_OUTPUT_TOKENS", raising=False)

    policy = get_agent_model_policy()
    assert policy["context"].model == "gemini-2.5-flash-lite"
    assert policy["context"].thinking_level == "minimal"
    assert policy["gap"].model == "gemini-2.5-flash"
    assert policy["gap"].max_output_tokens > policy["context"].max_output_tokens
    assert policy["attention"].model == "gemini-2.5-flash-lite"
    assert policy["partner"].thinking_level == "low"


def test_flagship_profile_is_opt_in(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_MODEL_PROFILE", "flagship")
    policy = get_agent_model_policy()
    assert policy["context"].thinking_level == "minimal"
    assert policy["gap"].model == "gemini-2.5-pro"
    assert policy["gap"].thinking_level == "high"
    assert policy["partner"].model == "gemini-2.5-flash"
    assert policy["partner"].thinking_level == "medium"


def test_role_overrides_are_independent(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_GAP_MODEL", "gemini-custom-gap")
    monkeypatch.setenv("AGENT_GAP_THINKING", "high")
    monkeypatch.setenv("AGENT_GAP_MAX_OUTPUT_TOKENS", "7777")
    monkeypatch.setenv("AGENT_PARTNER_THINKING_LEVEL", "medium")
    monkeypatch.setenv("AGENT_PARTNER_MAX_OUTPUT_TOKENS", "invalid")

    assert get_agent_model_config("gap").model == "gemini-custom-gap"
    assert get_agent_model_config("gap").thinking_level == "high"
    assert get_agent_model_config("gap").max_output_tokens == 7777
    assert get_agent_model_config("partner").thinking_level == "medium"
    assert get_agent_model_config("partner").max_output_tokens == 1024


def test_flash_lite_generation_config_omits_unsupported_thinking_field() -> None:
    from app.model_policy import generation_config_for

    config = generation_config_for(get_agent_model_config("context"))
    assert config.max_output_tokens == 1024
    assert config.thinking_config is None
