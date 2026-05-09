// Review phase evaluation.
//
// Review → Done:     Reviewer sent review-approved
// Review → Work:     Reviewer sent review-revise
// Review → Pre-Work: Reviewer sent review-rejected

import { TeamState } from '../state/team-state.js';
import { type AgentMessage } from '../router/message-types.js';
import { type PhaseEvaluation } from './phase-controller.js';
import { TeamPhase } from '../state/team-state.js';
import { Role, VALID_INSTANCES } from '../roles/role-types.js';
import { AgentState } from '../types/index.js';

export function evaluateReview(
  team: TeamState,
  message: AgentMessage
): PhaseEvaluation {
  if (message.roleSource !== Role.Reviewer) {
    return { shouldTransition: false, actions: [] };
  }

  switch (message.flag) {
    case 'review-approved':
      return {
        shouldTransition: true,
        targetPhase: TeamPhase.Done,
        trigger: 'review-approved',
        actions: [
          {
            type: 'set-agent-states',
            details: {
              targets: [...VALID_INSTANCES],
              state: AgentState.Done,
            },
          },
        ],
      };

    case 'review-revise':
      return {
        shouldTransition: true,
        targetPhase: TeamPhase.Work,
        trigger: 'review-revise',
        actions: [
          {
            type: 'send-revision-request',
            details: {
              reason: 'reviewer-revise',
              feedback: message.content,
            },
          },
          {
            type: 'set-agent-states',
            details: {
              targets: ['Worker-1', 'Worker-2'],
              state: AgentState.Active,
            },
          },
          {
            type: 'set-agent-states',
            details: {
              targets: ['Reviewer-1'],
              state: AgentState.Idle,
            },
          },
        ],
      };

    case 'review-rejected':
      return {
        shouldTransition: true,
        targetPhase: TeamPhase.PreWork,
        trigger: 'review-rejected',
        actions: [
          {
            type: 'set-agent-states',
            details: {
              targets: ['Worker-1', 'Worker-2'],
              state: AgentState.Active,
            },
          },
          {
            type: 'set-agent-states',
            details: {
              targets: ['Security-1'],
              state: AgentState.Active,
            },
          },
          {
            type: 'set-agent-states',
            details: {
              targets: ['Reviewer-1'],
              state: AgentState.Idle,
            },
          },
          {
            type: 'replan-task',
            details: {
              reason: message.content,
            },
          },
        ],
      };

    default:
      return { shouldTransition: false, actions: [] };
  }
}
