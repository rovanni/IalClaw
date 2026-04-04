/**
 * Razões padronizadas para as decisões de runtime.
 * Centraliza as chaves de i18n para garantir auditabilidade.
 */
export const RuntimeDecisionReasons = {
    NO_RUNNABLE_ENTRY: "tool.run.no_runnable_entry",
    HTML_WITHOUT_DOM: "tool.run.html_without_requiresDOM",
    EXECUTABLE_PROJECT: "runtime.success.project", // Placeholder para sucesso/continuação
    LEGACY_FALLBACK: "runtime.legacy_fallback",
    BROWSER_REQUIRED: "runtime.browser_validation_enabled"
} as const;

/**
 * Contrato de decisão de runtime do IalClaw.
 * Define se o plano deve ser executado e quais capacidades são obrigatórias.
 */
export interface PlanRuntimeDecision {
    shouldExecute: boolean;
    requiresBrowser: boolean;
    reasonKey: string; // Chave i18n
    decisionSource: "orchestrator" | "safe_mode";
}
