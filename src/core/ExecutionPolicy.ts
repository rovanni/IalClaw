// ── Execution Policy ──────────────────────────────────────────────────────
// Decisão por execução, não flag global.
// Construída pelo Controller com base no contexto da sessão/decisão.
// Propagada para Runtime/Loop — nenhum componente downstream consulta estado global.

export interface ExecutionPolicy {
    safeMode: boolean;
}
