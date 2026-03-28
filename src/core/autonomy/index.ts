// ── Autonomy Module ─────────────────────────────────────────────────────────
// Motor de decisão de autonomia: quando EXECUTAR, PERGUNTAR ou CONFIRMAR.

export {
    AutonomyDecision,
    decideAutonomy,
    createAutonomyContext,
    AutonomyHelpers,
    logAutonomyDecision,
    type AutonomyContext
} from './DecisionEngine';