export type AskSuggestionsStatus = 'preparing' | 'ready' | 'stale' | 'failed';

export interface AskSuggestionsAssessment {
  topQuestions: string[];
  otherQuestions: string[];
  projectId: string;
  semanticVersion?: string;
  generatedAt?: string;
  generatedBy?: string;
  status: AskSuggestionsStatus;
}

export interface AskSuggestionsResponseShape {
  topQuestions?: unknown[];
  otherQuestions?: unknown[];
  projectId?: string;
  error?: string;
  status?: string;
  semanticVersion?: string;
  generatedAt?: string;
  generatedBy?: string;
}

export function normalizeAskSuggestionsAssessment(
  data: AskSuggestionsResponseShape,
  expectedProjectId: string,
): AskSuggestionsAssessment {
  if (data.projectId !== expectedProjectId) {
    throw new Error('Suggestions are unavailable right now.');
  }
  const status: AskSuggestionsStatus = data.status === 'ready'
    || data.status === 'stale'
    || data.status === 'failed'
    || data.status === 'preparing'
    ? data.status
    : 'preparing';
  return {
    topQuestions: (data.topQuestions ?? [])
      .filter((question): question is string => typeof question === 'string')
      .slice(0, 3),
    otherQuestions: (data.otherQuestions ?? [])
      .filter((question): question is string => typeof question === 'string')
      .slice(0, 3),
    projectId: expectedProjectId,
    ...(data.semanticVersion ? { semanticVersion: data.semanticVersion } : {}),
    ...(data.generatedAt ? { generatedAt: data.generatedAt } : {}),
    ...(data.generatedBy ? { generatedBy: data.generatedBy } : {}),
    status,
  };
}

export async function pollAskSuggestions(params: {
  read: (signal: AbortSignal) => Promise<AskSuggestionsAssessment>;
  onUpdate: (assessment: AskSuggestionsAssessment) => void;
  onError?: (error: unknown) => void;
  onTimeout?: () => void;
  signal?: AbortSignal;
  intervalMs?: number;
  maxDurationMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<'ready' | 'failed' | 'timeout' | 'aborted'> {
  const controller = params.signal ? undefined : new AbortController();
  const signal = params.signal ?? controller!.signal;
  const intervalMs = params.intervalMs ?? 2_000;
  const maxDurationMs = params.maxDurationMs ?? 60_000;
  const now = params.now ?? Date.now;
  const sleep = params.sleep ?? waitFor;
  const deadline = now() + maxDurationMs;

  while (!signal.aborted) {
    let assessment: AskSuggestionsAssessment;
    try {
      assessment = await params.read(signal);
    } catch (error) {
      if (signal.aborted) return 'aborted';
      params.onError?.(error);
      return 'failed';
    }
    if (signal.aborted) return 'aborted';

    params.onUpdate(assessment);
    if (assessment.status === 'ready' || assessment.status === 'failed') {
      return assessment.status;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      params.onTimeout?.();
      return 'timeout';
    }
    try {
      await sleep(Math.min(intervalMs, remainingMs), signal);
    } catch (error) {
      if (signal.aborted) return 'aborted';
      params.onError?.(error);
      return 'failed';
    }
  }

  return 'aborted';
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('The suggestions request was aborted.', 'AbortError'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
