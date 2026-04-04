// Work phase evaluation.
//
// Standard mode: Transition to Handoff requires ALL:
//   1. All Workers sent task-complete to Supervisor
//   2. No Workers in blocked state
//
// Simple mode: Transition directly to Done (skip Handoff + Review):
//   1. Worker-1 sends task-complete → Done

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

    // Route based on task complexity
    const complexity = team.snapshot.currentTask?.complexity ?? 'standard';

    if (complexity === 'simple') {
      // Simple: skip Handoff + Review → go straight to Done
      return {
        shouldTransition: true,
        targetPhase: TeamPhase.Done,
        trigger: `${message.roleSourceInstance} task-complete (simple)`,
        actions: [
          {
            type: 'set-agent-states',
            details: {
              targets: workerInstances,
              state: AgentState.Done,
            },
          },
        ],
      };
    }

    // Standard: full pipeline → Handoff for Security sweep
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
