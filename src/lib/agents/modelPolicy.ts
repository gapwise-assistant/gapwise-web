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

const cheapDefaults: Record<AgentRole, Omit<AgentModelConfig, 'role'>> = {
  context: { model: 'gemini-2.5-flash-lite', thinkingLevel: 'minimal', maxOutputTokens: 1024 },
  gap: { model: 'gemini-2.5-flash', thinkingLevel: 'low', maxOutputTokens: 2048 },
  attention: { model: 'gemini-2.5-flash-lite', thinkingLevel: 'minimal', maxOutputTokens: 1024 },
  partner: { model: 'gemini-2.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 1024 },
};

const flagshipDefaults: Record<AgentRole, Omit<AgentModelConfig, 'role'>> = {
  context: cheapDefaults.context,
  gap: { model: 'gemini-2.5-pro', thinkingLevel: 'high', maxOutputTokens: 4096 },
  attention: { model: 'gemini-2.5-flash-lite', thinkingLevel: 'low', maxOutputTokens: 1536 },
  partner: { model: 'gemini-2.5-flash', thinkingLevel: 'medium', maxOutputTokens: 2048 },
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

export function getAgentModelConfig(role: AgentRole): AgentModelConfig {
  const prefix = `AGENT_${role.toUpperCase()}`;
  const defaults = (configuredProfile() === 'flagship' ? flagshipDefaults : cheapDefaults)[role];
  return {
    role,
    model: envValue(`${prefix}_MODEL`) ?? defaults.model,
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

export const AGENT_MODEL_POLICY_DEFAULTS = Object.freeze({ cheap: cheapDefaults, flagship: flagshipDefaults });
