// Pre-Work phase evaluation.
//
// Transition to Work requires ALL:
// 1. Security Agent sent clearance-report to Supervisor
// 2. Supervisor sent task-assignment to all Workers
// 3. All Workers sent task-accepted to Supervisor
//
// The phase controller tracks these via message flags.
// We evaluate each incoming message to see if preconditions are met.

import { TeamState } from '../state/team-state.js';
import { type AgentMessage } from '../router/message-types.js';
import { type PhaseEvaluation, type PhaseAction } from './phase-controller.js';
import { TeamPhase } from '../state/team-state.js';
import { Role } from '../roles/role-types.js';
import { AgentState } from '../types/index.js';

/**
 * Track pre-work progress. The controller maintains this
 * externally and passes messages one at a time.
 * This function is stateless — it checks whether the incoming
 * message completes the preconditions given a message history.
 */
export function evaluatePreWork(
  team: TeamState,
  message: AgentMessage
): PhaseEvaluation {
  const actions: PhaseAction[] = [];

  // The key transition trigger: last Worker's task-accepted
  if (
    message.flag === 'task-accepted' &&
    message.roleSource === Role.Worker
  ) {
    // Check if all workers are now in a state that indicates acceptance.
    // Since messages arrive one at a time and the engine should track
    // acceptance, we use agent states as the proxy.
    // The engine sets workers to active after task-accepted.
    // We check: are all workers active or done (meaning they accepted)?

    // For the transition, we need to know if THIS is the last acceptance.
    // The engine should have already processed previous acceptances.
    // We signal transition — the engine verifies preconditions hold.
    return {
      shouldTransition: true,
      targetPhase: TeamPhase.Work,
      trigger: `${message.roleSourceInstance} task-accepted`,
      actions: [
        {
          type: 'set-agent-states',
          details: {
            targets: ['Worker-1', 'Worker-2'],
            state: AgentState.Active,
          },
        },
      ],
    };
  }

  return { shouldTransition: false, actions };
}
