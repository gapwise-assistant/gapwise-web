import { Project, UserMemoryProfile } from '@/types/clarity';
import { ContextPack, DurableMemory } from '@/types/contextPack';
import { AttentionCandidate } from '@/types/attention';
import { buildContextPack } from '@/lib/retrieval/contextPack';
import { rankGaps } from '@/lib/tools/graphTools';
import { withAttentionScore } from '@/lib/attention/scoring';
import { projectForReasoning } from '@/lib/context/sourceState';
import {
  CAREER_CONFLICT_DEMO_ID,
  CAREER_CONFLICT_QUESTION_ID,
  CAREER_CONFLICT_RECRUITER_SOURCE_ID,
} from '@/lib/demo/careerConflict';
import { calendarTimestampFromText } from '@/lib/google/calendarFormatting';
import { isNextActionSatisfied } from '@/lib/actions/completion';

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function isActiveMemory(memory: DurableMemory): boolean {
  return !memory.forgotten_at && memory.status !== 'forgotten';
}

function hasPriority(memories: DurableMemory[], terms: string[]): boolean {
  return memories.some((memory) => isActiveMemory(memory) && memory.category === 'current_priorities' && includesAny(memory.text, terms));
}

function dueSoon(project: Project): boolean {
  if (!project.deadline) return false;
  const days = (new Date(project.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return days <= 21;
}

function nodeTimestamp(nodeText: string, label: 'Starts' | 'Ends'): number {
  const timestamp = calendarTimestampFromText(nodeText, label);
  if (!timestamp) return 0;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function calendarEventTitle(text: string): string {
  const match = text.match(/^Google Calendar event: ([^.]+)\./);
  return match?.[1] ?? 'Calendar commitment';
}

function isCalendarCommitment(node: ContextPack['upcomingCommitments'][number]): boolean {
  return node.source_refs.some((ref) => ref.startsWith('gcal_')) || node.why_it_matters?.includes('Source: Google Calendar') === true;
}

function calendarUrgency(startTime: number, endTime: number, nowTime: number): number {
  if (endTime > nowTime && startTime > 0 && startTime <= nowTime) return 1;
  if (startTime === 0) return 0.35;
  const hoursUntilStart = (startTime - nowTime) / (60 * 60 * 1000);
  if (hoursUntilStart <= 2) return 0.98;
  if (hoursUntilStart <= 12) return 0.86;
  if (hoursUntilStart <= 24) return 0.76;
  if (hoursUntilStart <= 48) return 0.64;
  if (hoursUntilStart <= 14 * 24) return 0.32;
  return 0.12;
}

function isUsefulCalendarCommitment(text: string, startTime: number, endTime: number, nowTime: number): boolean {
  if (endTime > nowTime && startTime > 0 && startTime <= nowTime) return true;
  if (startTime === 0) return false;
  const hoursUntilStart = (startTime - nowTime) / (60 * 60 * 1000);
  if (hoursUntilStart <= 48) return true;
  return includesAny(text, ['meeting', 'demo', 'interview', 'deadline', 'review', 'call', 'appointment']);
}

export function generateAttentionCandidates(params: {
  userId: string;
  project: Project;
  memories: DurableMemory[];
  profile?: UserMemoryProfile;
  contextPack?: ContextPack;
  now?: Date;
}): AttentionCandidate[] {
  const { userId, project, memories } = params;
  const reasoningProject = projectForReasoning(project);
  const now = params.now ?? new Date();
  const nowTime = now.getTime();
  const candidates: AttentionCandidate[] = [];
  const incomePriority = hasPriority(memories, ['financial', 'income', 'salary', 'stability', 'money']);
  const careerRoleAccepted = memories.some((memory) =>
    isActiveMemory(memory) && memory.id === 'career_demo_answer_acceptable'
  );
  const careerRoleRejected = memories.some((memory) =>
    isActiveMemory(memory) && memory.id === 'career_demo_answer_not_acceptable'
  );
  const noFrontendPreference = memories.some((memory) =>
    isActiveMemory(memory) && /do not|don't|avoid/.test(memory.text.toLowerCase()) && /frontend/.test(memory.text.toLowerCase())
  ) && !careerRoleAccepted;

  params.contextPack?.upcomingCommitments
    .filter(isCalendarCommitment)
    .filter((commitment) => !isNextActionSatisfied(reasoningProject, commitment))
    .forEach((commitment) => {
      const startTime = nodeTimestamp(commitment.text, 'Starts');
      const endTime = nodeTimestamp(commitment.text, 'Ends') || startTime;
      if (endTime !== 0 && endTime <= nowTime) return;
      if (!isUsefulCalendarCommitment(commitment.text, startTime, endTime, nowTime)) return;

      const title = calendarEventTitle(commitment.text);
      const urgency = calendarUrgency(startTime, endTime, nowTime);
      const sourceRef = commitment.source_refs[0];

      candidates.push(
        withAttentionScore({
          id: `rec_calendar_${commitment.id}`,
          kind: 'commitment',
          title: startTime > 0 && startTime <= nowTime ? `Stay with ${title}` : `Prepare for ${title}`,
          reason: 'From Google Calendar.',
          next_action: startTime > 0 && startTime <= nowTime
            ? 'Focus on the current commitment and capture any follow-up decision afterward.'
            : `Review what you need before ${title}.`,
          source_node_ids: [commitment.id],
          source_ids: sourceRef ? [sourceRef] : [],
          action_node_id: commitment.id,
          context_pack: params.contextPack!,
          status: 'active',
          factors: {
            goal_alignment: urgency >= 0.98
              ? 0.98
              : includesAny(commitment.text, ['gapswise', 'demo', 'project', 'meeting']) ? 0.86 : 0.42,
            impact: urgency >= 0.98 ? 0.95 : urgency >= 0.76 ? 0.82 : 0.35,
            urgency,
            actionability: urgency >= 0.64 ? 0.92 : 0.48,
            evidence_confidence: 0.95,
            unresolved_risk: urgency >= 0.98 ? 0.55 : urgency >= 0.76 ? 0.32 : 0.12,
            momentum: urgency >= 0.98 ? 0.9 : urgency >= 0.64 ? 0.78 : 0.35,
            estimated_effort: urgency >= 0.98 ? 0.08 : urgency >= 0.64 ? 0.12 : 0.4,
          },
        })
      );
    });

  reasoningProject.sources.forEach((source) => {
    const sourceText = `${source.filename} ${source.content}`;
    const isCareerDemoRecruiterSignal = project.id !== CAREER_CONFLICT_DEMO_ID
      || source.id === CAREER_CONFLICT_RECRUITER_SOURCE_ID;
    if (isCareerDemoRecruiterSignal && includesAny(sourceText, ['recruiter', 'salary', 'paying', 'better-paying', 'role'])) {
      const frontendRole = includesAny(sourceText, ['frontend', 'front-end']);
      const contextPack = buildContextPack({
        userId,
        query: sourceText,
        project,
        profile: {
          answer_density: 'concise',
          question_frequency: 'moderate',
          challenge_level: 'high',
          evidence_preference: 'research_first',
          brainstorm_style: 'diverge_then_converge',
          uncertainty_style: 'explicit',
        },
        durableMemories: memories,
      });
      if (frontendRole && noFrontendPreference) {
        if (careerRoleRejected) {
          candidates.push(
            withAttentionScore({
              id: `rec_recruiter_decline_${source.id}`,
              kind: 'opportunity',
              title: 'Tell the recruiter this role is not a fit',
              reason: 'Your confirmed role preference conflicts with this primarily frontend opportunity.',
              next_action: 'Decline the role or ask whether a less frontend-heavy path is available before the call.',
              source_node_ids: source.derived_node_ids,
              source_ids: [source.id],
              context_pack: contextPack,
              status: 'active',
              factors: {
                goal_alignment: 0.82,
                impact: 0.84,
                urgency: 0.82,
                actionability: 0.94,
                evidence_confidence: 0.9,
                unresolved_risk: 0.72,
                momentum: 0.82,
                estimated_effort: 0.18,
              },
            })
          );
        }
        return;
      }
      candidates.push(
        withAttentionScore({
          id: `rec_recruiter_${source.id}`,
          kind: 'opportunity',
          title: 'Reply to the recruiter opportunity',
          reason: incomePriority
            ? 'A recruiter signal matches your confirmed financial-stability priority.'
            : 'A recruiter signal may be an opportunity worth deciding on.',
          next_action: 'Draft a short reply and decide whether the role fits your current priorities.',
          source_node_ids: source.derived_node_ids,
          source_ids: [source.id],
          context_pack: contextPack,
          status: 'active',
          factors: {
            goal_alignment: incomePriority ? 0.98 : 0.55,
            impact: incomePriority ? 0.95 : 0.85,
            urgency: incomePriority ? 0.88 : 0.72,
            actionability: 0.9,
            evidence_confidence: 0.9,
            unresolved_risk: incomePriority ? 0.65 : 0.35,
            momentum: 0.75,
            estimated_effort: 0.18,
          },
        })
      );
    }

    if (includesAny(sourceText, ['cv', 'resume']) && includesAny(sourceText, ['missing', 'last updated', 'latest agentic ai', 'gapswise'])) {
      const contextPack = buildContextPack({
        userId,
        query: sourceText,
        project,
        profile: {
          answer_density: 'concise',
          question_frequency: 'moderate',
          challenge_level: 'high',
          evidence_preference: 'research_first',
          brainstorm_style: 'diverge_then_converge',
          uncertainty_style: 'explicit',
        },
        durableMemories: memories,
      });
      candidates.push(
        withAttentionScore({
          id: `rec_cv_${source.id}`,
          kind: 'opportunity',
          title: 'Update your CV with recent AI work',
          reason: 'A selected Drive file suggests your CV is missing the latest agentic AI project evidence.',
          next_action: 'Add Gapwise and recent agentic AI work to the CV before sharing it.',
          source_node_ids: source.derived_node_ids,
          source_ids: [source.id],
          context_pack: contextPack,
          status: 'active',
          factors: {
            goal_alignment: 0.78,
            impact: 0.7,
            urgency: 0.58,
            actionability: 0.82,
            evidence_confidence: 0.82,
            unresolved_risk: 0.35,
            momentum: 0.65,
            estimated_effort: 0.45,
          },
        })
      );
    }
  });

  rankGaps(reasoningProject, params.profile).slice(0, 5).forEach((gap) => {
    const node = reasoningProject.nodes.find((item) => item.id === gap.node_id);
    const relatedMeeting = reasoningProject.sources.find((source) => includesAny(source.content, ['meeting', 'demo tomorrow', 'tomorrow']));
    const contextPack = buildContextPack({
      userId,
      query: gap.question,
      project: reasoningProject,
      profile: {
        answer_density: 'concise',
        question_frequency: 'moderate',
        challenge_level: 'high',
        evidence_preference: 'research_first',
        brainstorm_style: 'diverge_then_converge',
        uncertainty_style: 'explicit',
      },
      durableMemories: memories,
    });
    candidates.push(
      withAttentionScore({
        id: `rec_gap_${gap.node_id}`,
        kind: relatedMeeting ? 'preparation' : 'gap',
        title: gap.node_id === CAREER_CONFLICT_QUESTION_ID
          ? 'Decide whether the frontend-heavy role fits your priorities'
          : gap.question,
        reason: gap.node_id === CAREER_CONFLICT_QUESTION_ID
          ? 'The job document conflicts with your preference to avoid frontend-heavy roles.'
          : gap.reasons[0] ?? 'This uncertainty affects the next decision.',
        next_action: gap.node_id === CAREER_CONFLICT_QUESTION_ID
          ? 'Answer whether the role remains acceptable before the recruiter call.'
          : gap.question,
        source_node_ids: [gap.node_id, ...gap.blocked_decision_ids],
        source_ids: node?.source_refs ?? [],
        action_node_id: gap.node_id,
        context_pack: contextPack,
        status: 'active',
        factors: {
          goal_alignment: 0.9,
          impact: gap.downstream_impact,
          urgency: relatedMeeting || dueSoon(project) ? 0.9 : gap.urgency,
          actionability: gap.answerability,
          evidence_confidence: node?.source_refs.length ? 0.75 : 0.45,
          unresolved_risk: gap.uncertainty,
          momentum: project.history.length ? 0.75 : 0.55,
          estimated_effort: gap.interruption_cost + 0.15,
        },
      })
    );
  });

  reasoningProject.nodes
    .filter((node) => node.status === 'OPEN'
      && (node.type === 'DECISION' || node.type === 'NEXT_ACTION')
      && (node.type !== 'NEXT_ACTION' || !isNextActionSatisfied(reasoningProject, node)))
    .forEach((node) => {
      const isDecision = node.type === 'DECISION';
      const contextPack = params.contextPack ?? buildContextPack({
        userId,
        query: node.text,
        project: reasoningProject,
        profile: {
          answer_density: 'concise',
          question_frequency: 'moderate',
          challenge_level: 'high',
          evidence_preference: 'research_first',
          brainstorm_style: 'diverge_then_converge',
          uncertainty_style: 'explicit',
        },
        durableMemories: memories,
      });
      candidates.push(withAttentionScore({
        id: `rec_${isDecision ? 'decision' : 'action'}_${node.id}`,
        kind: isDecision ? 'gap' : 'preparation',
        title: node.text,
        reason: node.why_it_matters?.[0] ?? (isDecision
          ? 'This project decision is still open.'
          : 'This is an available next step in the project.'),
        next_action: isDecision ? `Make and record the decision: ${node.text}` : node.text,
        source_node_ids: [node.id],
        source_ids: node.source_refs,
        action_node_id: node.id,
        context_pack: contextPack,
        status: 'active',
        factors: {
          goal_alignment: 0.78,
          impact: node.impact,
          urgency: dueSoon(project) ? 0.82 : 0.45,
          actionability: isDecision ? 0.65 : 0.9,
          evidence_confidence: node.confidence,
          unresolved_risk: isDecision ? 0.65 : 0.35,
          momentum: project.history.length ? 0.72 : 0.55,
          estimated_effort: isDecision ? 0.45 : 0.3,
        },
      }));
    });

  // Risks remain in the graph and Context Pack as evidence. They are not
  // emitted as standalone Today recommendations because a raw risk has no
  // answer or commitment the user can complete. Its linked UNKNOWN or
  // explicit NEXT_ACTION is what belongs in the attention feed.
  reasoningProject.nodes
    .filter((node) => node.type === 'RISK' && node.status === 'OPEN')
    .forEach((node) => {
      const contextPack = buildContextPack({
        userId,
        query: node.text,
        project,
        profile: {
          answer_density: 'concise',
          question_frequency: 'moderate',
          challenge_level: 'high',
          evidence_preference: 'research_first',
          brainstorm_style: 'diverge_then_converge',
          uncertainty_style: 'explicit',
        },
        durableMemories: memories,
      });
      candidates.push(
        withAttentionScore({
          id: `rec_risk_${node.id}`,
          kind: 'risk',
          title: 'Reduce a live project risk',
          reason: node.text,
          next_action: `Decide a mitigation for: ${node.text}`,
          source_node_ids: [node.id],
          source_ids: node.source_refs,
          context_pack: contextPack,
          status: 'active',
          factors: {
            goal_alignment: 0.8,
            impact: node.impact,
            urgency: dueSoon(project) ? 0.78 : 0.55,
            actionability: 0.65,
            evidence_confidence: node.source_refs.length ? 0.7 : 0.4,
            unresolved_risk: 1 - node.confidence,
            momentum: 0.45,
            estimated_effort: 0.45,
          },
        })
      );
    });

  return candidates;
}
