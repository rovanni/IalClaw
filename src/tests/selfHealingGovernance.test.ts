import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveOrchestrator } from '../core/orchestrator/CognitiveOrchestrator';

test('decideSelfHealing retorna false quando fail-safe esta ativado', () => {
    const orchestrator = new CognitiveOrchestrator({} as any, {} as any);
    const sessionId = 'self-healing-failsafe';

    orchestrator.ingestSignalsFromLoop({
        failSafe: { activated: true, trigger: 'intent_clear' }
    } as any, sessionId);
    orchestrator.ingestSelfHealingSignal({
        activated: true,
        attempts: 2,
        maxAttempts: 6,
        success: false,
        lastError: 'falha simulada',
        stepId: '1',
        toolName: 'workspace_save_artifact'
    }, sessionId);

    assert.equal(orchestrator.decideSelfHealing(sessionId), false);
});

test('decideSelfHealing retorna false quando stop-continue manda parar', () => {
    const orchestrator = new CognitiveOrchestrator({} as any, {} as any);
    const sessionId = 'self-healing-stop';

    orchestrator.ingestSignalsFromLoop({
        stop: {
            shouldStop: true,
            reason: 'low_improvement_delta',
            globalConfidence: 0.2,
            stepCount: 4
        }
    } as any, sessionId);
    orchestrator.ingestSelfHealingSignal({
        activated: true,
        attempts: 3,
        maxAttempts: 6,
        success: false,
        lastError: 'falha simulada',
        stepId: '2',
        toolName: 'workspace_validate_project'
    }, sessionId);

    assert.equal(orchestrator.decideSelfHealing(sessionId), false);
});

test('decideSelfHealing retorna undefined quando nao ha contexto extremo', () => {
    const orchestrator = new CognitiveOrchestrator({} as any, {} as any);
    const sessionId = 'self-healing-fallback';

    orchestrator.ingestSignalsFromLoop({} as any, sessionId);
    orchestrator.ingestSelfHealingSignal({
        activated: true,
        attempts: 1,
        maxAttempts: 6,
        success: false,
        lastError: 'falha simulada',
        stepId: '3',
        toolName: 'workspace_save_artifact'
    }, sessionId);

    assert.equal(orchestrator.decideSelfHealing(sessionId), undefined);
});