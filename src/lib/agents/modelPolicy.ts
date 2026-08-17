/**
 * Central model policy for the four-agent architecture.
 *
 * Keep this layer free of agent behavior: it only resolves model and generation
 * settings so each future ADK agent can be tuned independently. The cheap
 * profile is always the default; the flagship profile is opt-in.
 */
export type AgentRole = 'context' | 'gap' | 'attention' | 'partner';
export type AgentThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
export type AgentModelProfile = 'cheap' | 'flagship';

export interface AgentModelConfig {
  role: AgentRole;
  model: string;
  thinkingLevel: AgentThinkingLevel;
  maxOutputTokens: number;
}

export interface GapEscalationPolicy {
  enabled: boolean;
  maxRetries: number;
  closeCandidateMargin: number;
  lowConfidenceThreshold: number;
  highImpactThreshold: number;
  complexPathThreshold: number;
}

const cheapDefaults: Record<AgentRole, Omit<AgentModelConfig, 'role'>> = {
  context: { model: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal', maxOutputTokens: 1024 },
  gap: { model: 'gemini-3.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 2048 },
  attention: { model: 'gemini-3.5-flash-lite', thinkingLevel: 'minimal', maxOutputTokens: 1024 },
  partner: { model: 'gemini-3.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 1024 },
};

const flagshipDefaults: Record<AgentRole, Omit<AgentModelConfig, 'role'>> = {
  context: cheapDefaults.context,
  gap: { model: 'gemini-3.5-flash', thinkingLevel: 'high', maxOutputTokens: 4096 },
  attention: { model: 'gemini-3.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 1536 },
  partner: { model: 'gemini-3.5-flash', thinkingLevel: 'medium', maxOutputTokens: 2048 },
};

const thinkingLevels: AgentThinkingLevel[] = ['minimal', 'low', 'medium', 'high'];

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function configuredProfile(): AgentModelProfile {
  return envValue('AGENT_MODEL_PROFILE')?.toLowerCase() === 'flagship' ? 'flagship' : 'cheap';
}

function configuredThinkingLevel(prefix: string, fallback: AgentThinkingLevel): AgentThinkingLevel {
  const value = (envValue(`${prefix}_THINKING`) ?? envValue(`${prefix}_THINKING_LEVEL`))?.toLowerCase();
  return value && thinkingLevels.includes(value as AgentThinkingLevel)
    ? value as AgentThinkingLevel
    : fallback;
}

function configuredMaxOutputTokens(prefix: string, fallback: number): number {
  const value = Number.parseInt(envValue(`${prefix}_MAX_OUTPUT_TOKENS`) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function configuredBoolean(name: string, fallback: boolean): boolean {
  const value = envValue(name)?.toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function configuredNumber(name: string, fallback: number, minimum = 0): number {
  const value = Number.parseFloat(envValue(name) ?? '');
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

export function getAgentModelConfig(role: AgentRole): AgentModelConfig {
  const prefix = `AGENT_${role.toUpperCase()}`;
  const defaults = (configuredProfile() === 'flagship' ? flagshipDefaults : cheapDefaults)[role];
  const legacyModel = role === 'partner' && configuredProfile() === 'cheap'
    ? envValue('GEMINI_MODEL')
    : undefined;
  return {
    role,
    // GEMINI_MODEL remains the primary setting for the current root/Partner
    // agent; role-specific settings take precedence for future sub-agents.
    model: envValue(`${prefix}_MODEL`) ?? legacyModel ?? defaults.model,
    thinkingLevel: configuredThinkingLevel(prefix, defaults.thinkingLevel),
    maxOutputTokens: configuredMaxOutputTokens(prefix, defaults.maxOutputTokens),
  };
}

export function getAgentModelPolicy(): Record<AgentRole, AgentModelConfig> {
  return {
    context: getAgentModelConfig('context'),
    gap: getAgentModelConfig('gap'),
    attention: getAgentModelConfig('attention'),
    partner: getAgentModelConfig('partner'),
  };
}

/** Conservative, opt-in escalation policy for the high-reasoning Gap Agent. */
export function getGapEscalationPolicy(): GapEscalationPolicy {
  return {
    enabled: configuredBoolean('AGENT_GAP_ESCALATION_ENABLED', false),
    maxRetries: Math.min(2, Math.max(0, Math.floor(configuredNumber('AGENT_GAP_ESCALATION_MAX_RETRIES', 1)))),
    closeCandidateMargin: configuredNumber('AGENT_GAP_ESCALATION_MARGIN', 0.05),
    lowConfidenceThreshold: configuredNumber('AGENT_GAP_ESCALATION_LOW_CONFIDENCE', 0.45),
    highImpactThreshold: configuredNumber('AGENT_GAP_ESCALATION_HIGH_IMPACT', 0.9),
    complexPathThreshold: Math.max(1, Math.floor(configuredNumber('AGENT_GAP_ESCALATION_COMPLEXITY', 2, 1))),
  };
}

/** Stronger configuration used only when an opted-in escalation is triggered. */
export function getGapEscalationModelConfig(): AgentModelConfig {
  const base = getAgentModelConfig('gap');
  const flagship = AGENT_MODEL_POLICY_DEFAULTS.flagship.gap;
  return {
    ...base,
    model: envValue('AGENT_GAP_ESCALATION_MODEL') ?? flagship.model,
    thinkingLevel: configuredThinkingLevel('AGENT_GAP_ESCALATION', 'high'),
    maxOutputTokens: configuredMaxOutputTokens('AGENT_GAP_ESCALATION', flagship.maxOutputTokens),
  };
}

export const AGENT_MODEL_POLICY_DEFAULTS = Object.freeze({ cheap: cheapDefaults, flagship: flagshipDefaults });
