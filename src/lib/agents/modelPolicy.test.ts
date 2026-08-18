import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAgentModelConfig, getAgentModelPolicy, getGapEscalationModelConfig, getGapEscalationPolicy, getGapEvaluationProfiles } from './modelPolicy';

describe('four-agent model policy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the cheap profile by default', () => {
    vi.stubEnv('AGENT_MODEL_PROFILE', 'cheap');
    vi.stubEnv('AGENT_CONTEXT_MODEL', '');
    vi.stubEnv('AGENT_GAP_MODEL', '');
    vi.stubEnv('AGENT_ATTENTION_MODEL', '');
    vi.stubEnv('AGENT_PARTNER_MODEL', '');

    expect(getAgentModelPolicy()).toEqual({
      context: { role: 'context', model: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal', maxOutputTokens: 1024 },
      gap: { role: 'gap', model: 'gemini-3.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 2048 },
      attention: { role: 'attention', model: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal', maxOutputTokens: 1024 },
      partner: { role: 'partner', model: 'gemini-3.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 1024 },
    });
  });

  it('supports the opt-in flagship profile while keeping cheap context and attention', () => {
    vi.stubEnv('AGENT_MODEL_PROFILE', 'flagship');
    const policy = getAgentModelPolicy();
    expect(policy.context.model).toBe('gemini-3.5-flash-lite');
    expect(policy.context.thinkingLevel).toBe('minimal');
    expect(policy.gap).toMatchObject({ model: 'gemini-3.5-flash', thinkingLevel: 'high', maxOutputTokens: 4096 });
    expect(policy.attention.model).toBe('gemini-3.5-flash-lite');
    expect(policy.partner).toMatchObject({ model: 'gemini-3.5-flash', thinkingLevel: 'medium' });
  });

  it('allows each role to override model, thinking, and output budget independently', () => {
    vi.stubEnv('AGENT_GAP_MODEL', 'gemini-custom-gap');
    vi.stubEnv('AGENT_GAP_THINKING', 'high');
    vi.stubEnv('AGENT_GAP_MAX_OUTPUT_TOKENS', '7777');
    vi.stubEnv('AGENT_PARTNER_THINKING_LEVEL', 'medium');
    vi.stubEnv('AGENT_PARTNER_MAX_OUTPUT_TOKENS', 'not-a-number');

    expect(getAgentModelConfig('gap')).toEqual({ role: 'gap', model: 'gemini-custom-gap', thinkingLevel: 'high', maxOutputTokens: 7777 });
    expect(getAgentModelConfig('partner')).toMatchObject({ role: 'partner', thinkingLevel: 'medium', maxOutputTokens: 1024 });
  });

  it('keeps Gap escalation disabled by default and supports an opt-in stronger retry policy', () => {
    expect(getGapEscalationPolicy().enabled).toBe(false);
    vi.stubEnv('AGENT_GAP_ESCALATION_ENABLED', 'true');
    vi.stubEnv('AGENT_GAP_ESCALATION_MAX_RETRIES', '1');
    vi.stubEnv('AGENT_GAP_ESCALATION_MODEL', 'gemini-3.5-flash');
    vi.stubEnv('AGENT_GAP_ESCALATION_THINKING', 'high');
    vi.stubEnv('AGENT_GAP_ESCALATION_MAX_OUTPUT_TOKENS', '4096');
    expect(getGapEscalationPolicy().enabled).toBe(true);
    expect(getGapEscalationModelConfig()).toMatchObject({
      role: 'gap',
      model: 'gemini-3.5-flash',
      thinkingLevel: 'high',
      maxOutputTokens: 4096,
    });
  });

  it('provides independently tunable bounded Gap evaluation profiles', () => {
    vi.stubEnv('AGENT_GAP_MODEL', 'cheap-model');
    vi.stubEnv('AGENT_GAP_ESCALATION_MODEL', 'strong-model');
    vi.stubEnv('AGENT_GAP_EVAL_BALANCED_MAX_OUTPUT_TOKENS', '2500');

    expect(getGapEvaluationProfiles()).toEqual([
      expect.objectContaining({ id: 'cheap', model: 'cheap-model', role: 'gap' }),
      expect.objectContaining({ id: 'balanced', model: 'strong-model', thinkingLevel: 'medium', maxOutputTokens: 2500 }),
      expect.objectContaining({ id: 'strong', model: 'strong-model', thinkingLevel: 'high' }),
    ]);
  });
});
