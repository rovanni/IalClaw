import assert from 'node:assert/strict';
import { StepResultValidator } from './StepResultValidator';

const LEGACY_EXECUTION_CLAIM_PATTERNS: RegExp[] = [
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

const LEGACY_INSTALL_SUCCESS_CLAIM_PATTERNS: RegExp[] = [
    /\bskill\s+instalad[oa]\s+com\s+sucesso\b/i,
    /\binstalad[oa]\s+com\s+sucesso\b/i,
    /\binstalled\s+successfully\b/i,
    /\badded\s+\d+\s+packages\b/i
];

const LEGACY_INSTALL_EVIDENCE_PATTERNS: RegExp[] = [
    /OK:\s*(SKILL\.md|skill\.json|README\.md)\s+salvo\s+em\s+skills\/public\//i,
    /skills\/public\/[a-z0-9\-_]+\//i,
    /auditoria\s+(aprovada|concluida\s+com\s+sucesso)/i,
    /added\s+\d+\s+packages/i,
    /•\s+[a-z0-9\-_]+/i
];

function legacyValidateExecutionClaim(text: string): boolean {
    return LEGACY_EXECUTION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function legacyValidateGroundingEvidence(answer: string, toolEvidence: string[]): boolean {
    const evidenceBlob = toolEvidence.join('\n');
    const claimsInstallSuccess = LEGACY_INSTALL_SUCCESS_CLAIM_PATTERNS.some((pattern) => pattern.test(answer));

    if (claimsInstallSuccess) {
        return LEGACY_INSTALL_EVIDENCE_PATTERNS.some((pattern) => pattern.test(evidenceBlob));
    }

    return toolEvidence.length > 0;
}

function legacyBuildRealityCheckSignal(
    hasExecutionClaim: boolean,
    hasGroundingEvidence: boolean,
    toolCallsCount: number
) {
    if (!hasExecutionClaim) {
        return {
            shouldInject: false,
            reason: 'no_execution_claim' as const,
            toolCallsCount,
            hasGroundingEvidence
        };
    }

    if (hasGroundingEvidence) {
        return {
            shouldInject: false,
            reason: 'grounded_by_tool_evidence' as const,
            toolCallsCount,
            hasGroundingEvidence
        };
    }

    return {
        shouldInject: true,
        reason: toolCallsCount > 0 ? 'missing_grounding_evidence' as const : 'no_tool_call' as const,
        toolCallsCount,
        hasGroundingEvidence
    };
}

export function runStepResultValidatorTests(): void {
    // Success/failure patterns
    assert.equal(StepResultValidator.validateExecutionClaim('Installed successfully.'), true);
    assert.equal(StepResultValidator.validateExecutionClaim('Criado com sucesso o artefato.'), true);
    assert.equal(StepResultValidator.validateExecutionClaim('Apenas explicando o processo.'), false);

    // False-claim detection (claim sem evidence)
    const installClaimAnswer = 'Skill instalada com sucesso!';
    const unrelatedEvidence = ['Hora atual: 12:34'];
    assert.equal(StepResultValidator.validateGroundingEvidence(installClaimAnswer, unrelatedEvidence), false);

    // Evidence positiva para instalação
    const validInstallEvidence = [
        'OK: SKILL.md salvo em skills/public/elite-designer/',
        'auditoria aprovada'
    ];
    assert.equal(StepResultValidator.validateGroundingEvidence(installClaimAnswer, validInstallEvidence), true);

    // Technical error patterns / sem evidência útil
    const errorEvidence = ['npm ERR! code E404', 'Falha ao baixar dependências'];
    assert.equal(StepResultValidator.validateGroundingEvidence(installClaimAnswer, errorEvidence), false);

    // buildRealityCheckSignal
    assert.deepEqual(
        StepResultValidator.buildRealityCheckSignal(false, false, 0),
        { shouldInject: false, reason: 'no_execution_claim', toolCallsCount: 0, hasGroundingEvidence: false }
    );
    assert.deepEqual(
        StepResultValidator.buildRealityCheckSignal(true, true, 1),
        { shouldInject: false, reason: 'grounded_by_tool_evidence', toolCallsCount: 1, hasGroundingEvidence: true }
    );
    assert.deepEqual(
        StepResultValidator.buildRealityCheckSignal(true, false, 0),
        { shouldInject: true, reason: 'no_tool_call', toolCallsCount: 0, hasGroundingEvidence: false }
    );
    assert.deepEqual(
        StepResultValidator.buildRealityCheckSignal(true, false, 2),
        { shouldInject: true, reason: 'missing_grounding_evidence', toolCallsCount: 2, hasGroundingEvidence: false }
    );

    // Parity check (novo vs legado) em entradas conhecidas
    const vectors = [
        { answer: 'Installed successfully.', evidence: [], calls: 0 },
        { answer: 'Skill instalada com sucesso!', evidence: ['Hora atual: 10:00'], calls: 1 },
        { answer: 'Skill instalada com sucesso!', evidence: ['OK: README.md salvo em skills/public/test/'], calls: 1 },
        { answer: 'Build successful. Artifact created.', evidence: ['stdout: done'], calls: 1 },
        { answer: 'Apenas uma análise sem execução.', evidence: [], calls: 0 },
        { answer: 'added 45 packages in 3s', evidence: ['added 45 packages in 3s'], calls: 1 },
    ];

    for (const vector of vectors) {
        const legacyHasClaim = legacyValidateExecutionClaim(vector.answer);
        const newHasClaim = StepResultValidator.validateExecutionClaim(vector.answer);
        assert.equal(newHasClaim, legacyHasClaim);

        const legacyGrounding = vector.calls > 0 && legacyValidateGroundingEvidence(vector.answer, vector.evidence);
        const newGrounding = vector.calls > 0 && StepResultValidator.validateGroundingEvidence(vector.answer, vector.evidence);
        assert.equal(newGrounding, legacyGrounding);

        const legacySignal = legacyBuildRealityCheckSignal(legacyHasClaim, legacyGrounding, vector.calls);
        const newSignal = StepResultValidator.buildRealityCheckSignal(newHasClaim, newGrounding, vector.calls);
        assert.deepEqual(newSignal, legacySignal);
    }
}
