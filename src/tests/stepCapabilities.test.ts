import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresDOM, resolveRuntimeModeForPlan, sanitizeStep } from '../capabilities/stepCapabilities';
import { ExecutionPlan } from '../core/planner/types';

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

test('runtime mode pula browser para projeto HTML sem requiresDOM', () => {
    const plan: ExecutionPlan = {
        goal: 'crie um jogo da cobrinha em HTML',
        steps: [
            {
                id: 1,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: {}
            }
        ]
    };

    const mode = resolveRuntimeModeForPlan(plan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);

    assert.equal(mode.requiresBrowserValidation, false);
    assert.equal(mode.skipRuntimeExecution, true);
    assert.equal(mode.skipReason, 'html_without_requiresDOM');
});

test('runtime mode pula execucao quando nao existe entry point suportado', () => {
    const plan: ExecutionPlan = {
        goal: 'registrar tarefa fallback em markdown',
        steps: [
            {
                id: 1,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: { filename: 'IALCLAW_FALLBACK_TASK.md', content: '# fallback' }
            }
        ]
    };

    const mode = resolveRuntimeModeForPlan(plan, [
        { name: 'IALCLAW_FALLBACK_TASK.md', relative_path: 'IALCLAW_FALLBACK_TASK.md', size: 100, preview: '# fallback' }
    ]);

    assert.equal(mode.requiresBrowserValidation, false);
    assert.equal(mode.skipRuntimeExecution, true);
    assert.equal(mode.skipReason, 'no_runnable_entry');
});

test('runtime mode exige browser para projeto HTML com requiresDOM', () => {
    const plan: ExecutionPlan = {
        goal: 'valide no navegador se o canvas renderiza',
        steps: [
            {
                id: 1,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: {},
                capabilities: { requiresDOM: true }
            }
        ]
    };

    const mode = resolveRuntimeModeForPlan(plan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);

    assert.equal(mode.requiresBrowserValidation, true);
    assert.equal(mode.skipRuntimeExecution, false);
});
