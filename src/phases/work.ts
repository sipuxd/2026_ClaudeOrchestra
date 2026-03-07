// Work phase evaluation.
//
// Transition to Handoff requires ALL:
// 1. All Workers sent task-complete to Supervisor
// 2. No Workers in blocked state

import { TeamState } from '../state/team-state.js';
import { type AgentMessage } from '../router/message-types.js';
import { type PhaseEvaluation, type PhaseAction } from './phase-controller.js';
import { TeamPhase } from '../state/team-state.js';
import { Role, ROLE_INSTANCES } from '../roles/role-types.js';
import { AgentState } from '../types/index.js';

export function evaluateWork(
  team: TeamState,
  message: AgentMessage
): PhaseEvaluation {
  const actions: PhaseAction[] = [];

  // Transition trigger: last Worker's task-complete
  if (
    message.flag === 'task-complete' &&
    message.roleSource === Role.Worker
  ) {
    // Check that no workers are blocked
    const workerInstances = ROLE_INSTANCES[Role.Worker];
    const hasBlockedWorker = workerInstances.some((inst) => {
      const agent = team.getAgent(inst);
      return agent?.state === AgentState.Blocked;
    });

    if (hasBlockedWorker) {
      return { shouldTransition: false, actions };
    }

    return {
      shouldTransition: true,
      targetPhase: TeamPhase.Handoff,
      trigger: `${message.roleSourceInstance} task-complete`,
      actions: [
        {
          type: 'set-agent-states',
          details: {
            targets: workerInstances,
            state: AgentState.Done,
          },
        },
        {
          type: 'send-sweep-request',
          details: {},
        },
      ],
    };
  }

  return { shouldTransition: false, actions };
}
