// Workflow state machine. Manages phase transitions based on
// messages received, enforces preconditions, emits events,
// and delegates to per-phase handlers.

import { EventEmitter } from 'node:events';
import { TeamState, TeamPhase, TransitionError } from '../state/team-state.js';
import { type AgentMessage } from '../router/message-types.js';
import { evaluatePreWork } from './pre-work.js';
import { evaluateWork } from './work.js';
import { evaluateHandoff } from './handoff.js';
import { evaluateReview } from './review.js';

// --- Phase controller events ---

export interface PhaseControllerEvents {
  transition: [from: TeamPhase, to: TeamPhase, trigger: string];
  'action-required': [action: PhaseAction];
  error: [error: TransitionError];
}

// --- Actions the engine should take after a phase evaluation ---

export interface PhaseAction {
  type:
    | 'send-sweep-request'
    | 'send-review-request'
    | 'send-revision-request'
    | 'set-agent-states'
    | 'replan-task';
  details: Record<string, unknown>;
}

// --- Phase evaluation result ---

export interface PhaseEvaluation {
  /** Whether a phase transition should occur */
  shouldTransition: boolean;
  /** Target phase if transitioning */
  targetPhase?: TeamPhase;
  /** What triggered the transition */
  trigger?: string;
  /** Actions the engine should take */
  actions: PhaseAction[];
}

// --- Phase controller ---

export class PhaseController extends EventEmitter<PhaseControllerEvents> {
  /**
   * Evaluate a message in the context of the current team phase.
   * Returns what should happen (transition, actions) without
   * mutating state — the caller decides whether to apply.
   */
  evaluate(team: TeamState, message: AgentMessage): PhaseEvaluation {
    switch (team.currentPhase) {
      case TeamPhase.PreWork:
        return evaluatePreWork(team, message);
      case TeamPhase.Work:
        return evaluateWork(team, message);
      case TeamPhase.Handoff:
        return evaluateHandoff(team, message);
      case TeamPhase.Review:
        return evaluateReview(team, message);
      default:
        // Terminal states — no transitions possible
        return { shouldTransition: false, actions: [] };
    }
  }

  /**
   * Apply a phase evaluation result to the team state.
   * Performs the transition and emits events.
   */
  apply(team: TeamState, evaluation: PhaseEvaluation): void {
    if (!evaluation.shouldTransition || !evaluation.targetPhase) {
      // Emit actions even without transition
      for (const action of evaluation.actions) {
        this.emit('action-required', action);
      }
      return;
    }

    const from = team.currentPhase;
    const to = evaluation.targetPhase;
    const trigger = evaluation.trigger ?? 'unknown';

    try {
      team.transitionPhase(to);
      this.emit('transition', from, to, trigger);
    } catch (err) {
      if (err instanceof TransitionError) {
        this.emit('error', err);
        // If the transition threw because of loop limits,
        // the team is now in errored state — emit that transition
        if (team.currentPhase === TeamPhase.Errored && from !== TeamPhase.Errored) {
          this.emit('transition', from, TeamPhase.Errored, err.message);
        }
        return;
      }
      throw err;
    }

    // Emit actions after successful transition
    for (const action of evaluation.actions) {
      this.emit('action-required', action);
    }
  }

  /**
   * Convenience: evaluate + apply in one call.
   */
  processMessage(team: TeamState, message: AgentMessage): PhaseEvaluation {
    const evaluation = this.evaluate(team, message);
    this.apply(team, evaluation);
    return evaluation;
  }

  /**
   * Force a transition to errored state (timeout, deadlock, etc.).
   */
  forceError(team: TeamState, reason: string): void {
    const from = team.currentPhase;
    try {
      team.transitionPhase(TeamPhase.Errored);
      this.emit('transition', from, TeamPhase.Errored, reason);
    } catch (err) {
      if (err instanceof TransitionError) {
        this.emit('error', err);
      }
    }
  }

  /**
   * Force a transition to cancelled state.
   */
  forceCancel(team: TeamState, reason: string): void {
    const from = team.currentPhase;
    try {
      team.transitionPhase(TeamPhase.Cancelled);
      this.emit('transition', from, TeamPhase.Cancelled, reason);
    } catch (err) {
      if (err instanceof TransitionError) {
        this.emit('error', err);
      }
    }
  }
}
