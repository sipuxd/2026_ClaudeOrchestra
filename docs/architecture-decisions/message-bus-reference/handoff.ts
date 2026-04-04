// Handoff phase evaluation.
//
// Handoff → Review: Security sent handoff-clearance with APPROVED or FLAGGED
// Handoff → Work:   Security sent handoff-clearance with BLOCKED

import { TeamState } from '../state/team-state.js';
import { type AgentMessage } from '../router/message-types.js';
import { type PhaseEvaluation } from './phase-controller.js';
import { TeamPhase } from '../state/team-state.js';
import { Role } from '../roles/role-types.js';
import { AgentState } from '../types/index.js';

export function evaluateHandoff(
  team: TeamState,
  message: AgentMessage
): PhaseEvaluation {
  if (
    message.flag === 'handoff-clearance' &&
    message.roleSource === Role.Security
  ) {
    const content = message.content.toUpperCase();

    // BLOCKED → back to Work with revision
    if (content.startsWith('BLOCKED')) {
      return {
        shouldTransition: true,
        targetPhase: TeamPhase.Work,
        trigger: 'handoff-clearance BLOCKED',
        actions: [
          {
            type: 'send-revision-request',
            details: {
              reason: 'security-blocked',
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
              targets: ['Security-1'],
              state: AgentState.Idle,
            },
          },
        ],
      };
    }

    // APPROVED or FLAGGED → proceed to Review
    return {
      shouldTransition: true,
      targetPhase: TeamPhase.Review,
      trigger: `handoff-clearance ${content.startsWith('FLAGGED') ? 'FLAGGED' : 'APPROVED'}`,
      actions: [
        {
          type: 'set-agent-states',
          details: {
            targets: ['Security-1'],
            state: AgentState.Done,
          },
        },
        {
          type: 'send-review-request',
          details: {
            cautionNotes: content.startsWith('FLAGGED') ? message.content : null,
          },
        },
        {
          type: 'set-agent-states',
          details: {
            targets: ['Reviewer-1'],
            state: AgentState.Active,
          },
        },
      ],
    };
  }

  return { shouldTransition: false, actions: [] };
}
