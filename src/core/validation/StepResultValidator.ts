import { RealityCheckSignal } from '../../engine/AgentLoopTypes';

export class StepResultValidator {
    private static readonly EXECUTION_CLAIM_PATTERNS: RegExp[] = [
        /\binstalled\b/i,
        /\binstalad[oa]\b/i,
        /\badded\s+\d+\s+packages\b/i,
        /\bcreated\s+(file|project|artifact)\b/i,
        /\bcriad[oa]\s+com\s+sucesso\b/i,
        /\bexecuted\s+successfully\b/i,
        /\bexecu(tado|cao)\s+com\s+sucesso\b/i,
        /\bbuild\s+(successful|completed|ok)\b/i,
        /\bdeploy\s+(successful|completed|concluido|concluida)\b/i,
        /\b(npm\s+install|yarn\s+add|pnpm\s+add|pip\s+install)\b/i
    ];

    private static readonly INSTALL_SUCCESS_CLAIM_PATTERNS: RegExp[] = [
        /\bskill\s+instalad[oa]\s+com\s+sucesso\b/i,
        /\binstalad[oa]\s+com\s+sucesso\b/i,
        /\binstalled\s+successfully\b/i,
        /\badded\s+\d+\s+packages\b/i
    ];

    private static readonly INSTALL_EVIDENCE_PATTERNS: RegExp[] = [
        /OK:\s*(SKILL\.md|skill\.json|README\.md)\s+salvo\s+em\s+skills\/public\//i,
        /skills\/public\/[a-z0-9\-_]+\//i,
        /auditoria\s+(aprovada|concluida\s+com\s+sucesso)/i,
        /added\s+\d+\s+packages/i,
        /•\s+[a-z0-9\-_]+/i
    ];

    /**
     * Valida se a resposta contém uma reivindicação de execução bem-sucedida (Execution Claim).
     * @param text O texto a ser validado.
     * @returns True se contiver uma reivindicação de execução.
     */
    public static validateExecutionClaim(text: string): boolean {
        return this.EXECUTION_CLAIM_PATTERNS.some(pattern => pattern.test(text));
    }

    /**
     * Valida se existem evidências técnicas que sustentem as reivindicações feitas na resposta.
     * @param answer A resposta do assistente.
     * @param toolEvidence Lista de evidências (outputs) das ferramentas executadas.
     * @returns True se a evidência for suficiente para sustentar a resposta.
     */
    public static validateGroundingEvidence(answer: string, toolEvidence: string[]): boolean {
        const evidenceBlob = toolEvidence.join('\n');

        const claimsInstallSuccess = this.INSTALL_SUCCESS_CLAIM_PATTERNS.some(pattern => pattern.test(answer));
        if (claimsInstallSuccess) {
            return this.INSTALL_EVIDENCE_PATTERNS.some(pattern => pattern.test(evidenceBlob));
        }

        return toolEvidence.length > 0;
    }

    /**
     * Constrói o signal de Reality Check com base no cruzamento entre Claims e Evidence.
     * @param hasExecutionClaim Se houve reivindicação de execução.
     * @param hasGroundingEvidence Se houve evidência técnica comprovada.
     * @param toolCallsCount Quantidade de chamadas de ferramenta na iteração.
     * @returns RealityCheckSignal puro.
     */
    public static buildRealityCheckSignal(
        hasExecutionClaim: boolean,
        hasGroundingEvidence: boolean,
        toolCallsCount: number
    ): RealityCheckSignal {
        if (!hasExecutionClaim) {
            return {
                shouldInject: false,
                reason: 'no_execution_claim',
                toolCallsCount,
                hasGroundingEvidence
            };
        }

        if (hasGroundingEvidence) {
            return {
                shouldInject: false,
                reason: 'grounded_by_tool_evidence',
                toolCallsCount,
                hasGroundingEvidence
            };
        }

        return {
            shouldInject: true,
            reason: toolCallsCount > 0 ? 'missing_grounding_evidence' : 'no_tool_call',
            toolCallsCount,
            hasGroundingEvidence
        };
    }
}
