import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresDOM, extractPlanRuntimeSignals, sanitizeStep } from '../capabilities/stepCapabilities';
import { CognitiveOrchestrator } from '../core/orchestrator/CognitiveOrchestrator';
import { FlowManager } from '../core/flow/FlowManager';
import { ExecutionPlan } from '../core/planner/types';

// Responsabilidade da camada: stepCapabilities retorna sinais puros (fatos).
// Responsabilidade da camada: CognitiveOrchestrator decide skip/execute a partir dos sinais.

test('sanitizeStep normaliza requiresDOM para boolean estrito', () => {
    const sanitized = sanitizeStep({
        id: 1,
        type: 'tool',
        tool: 'workspace_save_artifact',
        input: {},
        capabilities: { requiresDOM: 'yes' as any }
    });

    assert.equal(requiresDOM(sanitized), false);
    assert.deepEqual(sanitized.capabilities, { requiresDOM: false });
});

// ─── Sinais puros (stepCapabilities) ─────────────────────────────────────────

test('sinais puros: HTML sem requiresDOM nao tem domSteps', () => {
    const plan: ExecutionPlan = {
        goal: 'crie um jogo da cobrinha em HTML',
        steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {} }]
    };

    const signals = extractPlanRuntimeSignals(plan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);

    assert.equal(signals.hasHtmlEntry, true);
    assert.equal(signals.hasDomSteps, false);
    assert.equal(signals.hasNodeEntry, false);
});

test('sinais puros: plano sem entry point nao tem htmlEntry nem nodeEntry', () => {
    const plan: ExecutionPlan = {
        goal: 'registrar tarefa fallback em markdown',
        steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: { filename: 'IALCLAW_FALLBACK_TASK.md', content: '# fallback' } }]
    };

    const signals = extractPlanRuntimeSignals(plan, [
        { name: 'IALCLAW_FALLBACK_TASK.md', relative_path: 'IALCLAW_FALLBACK_TASK.md', size: 100, preview: '# fallback' }
    ]);

    assert.equal(signals.hasHtmlEntry, false);
    assert.equal(signals.hasNodeEntry, false);
    assert.equal(signals.hasDomSteps, false);
});

test('sinais puros: HTML com requiresDOM tem domSteps', () => {
    const plan: ExecutionPlan = {
        goal: 'valide no navegador se o canvas renderiza',
        steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {}, capabilities: { requiresDOM: true } }]
    };

    const signals = extractPlanRuntimeSignals(plan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);

    assert.equal(signals.hasHtmlEntry, true);
    assert.equal(signals.hasDomSteps, true);
});

// ─── Decisao (Orchestrator) ───────────────────────────────────────────────────

test('orchestrator: HTML sem requiresDOM pula browser e nao executa', () => {
    const orchestrator = new CognitiveOrchestrator({} as any, new FlowManager());
    const plan: ExecutionPlan = {
        goal: 'crie um jogo da cobrinha em HTML',
        steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {} }]
    };

    const signals = extractPlanRuntimeSignals(plan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);
    const decision = orchestrator.decidePlanRuntimeMode(signals);

    assert.ok(decision);
    assert.equal(decision.shouldExecute, false);
    assert.equal(decision.requiresBrowser, false);
    assert.equal(decision.decisionSource, 'orchestrator');
});

test('orchestrator: plano sem entry point pula execucao', () => {
    const orchestrator = new CognitiveOrchestrator({} as any, new FlowManager());
    const plan: ExecutionPlan = {
        goal: 'registrar tarefa fallback em markdown',
        steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: { filename: 'IALCLAW_FALLBACK_TASK.md', content: '# fallback' } }]
    };

    const signals = extractPlanRuntimeSignals(plan, [
        { name: 'IALCLAW_FALLBACK_TASK.md', relative_path: 'IALCLAW_FALLBACK_TASK.md', size: 100, preview: '# fallback' }
    ]);
    const decision = orchestrator.decidePlanRuntimeMode(signals);

    assert.ok(decision);
    assert.equal(decision.shouldExecute, false);
    assert.equal(decision.requiresBrowser, false);
});

test('orchestrator: HTML com requiresDOM exige browser e executa', () => {
    const orchestrator = new CognitiveOrchestrator({} as any, new FlowManager());
    const plan: ExecutionPlan = {
        goal: 'valide no navegador se o canvas renderiza',
        steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {}, capabilities: { requiresDOM: true } }]
    };

    const signals = extractPlanRuntimeSignals(plan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);
    const decision = orchestrator.decidePlanRuntimeMode(signals);

    assert.ok(decision);
    assert.equal(decision.shouldExecute, true);
    assert.equal(decision.requiresBrowser, true);
    assert.equal(decision.decisionSource, 'orchestrator');
});
