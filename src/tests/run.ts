import assert from 'node:assert/strict';
import { getRequiredCapabilitiesForPlanStep } from '../capabilities/taskCapabilities';
import { requiresDOM, resolveRuntimeModeForPlan, sanitizeStep } from '../capabilities/stepCapabilities';
import { createWebProjectTemplate } from '../core/planner/templates/planTemplates';
import { ExecutionPlan } from '../core/planner/types';
import { LLMProvider, MessagePayload, ProviderResponse } from '../engine/ProviderFactory';

class FakeProvider implements LLMProvider {
    async generate(_messages: MessagePayload[], _tools?: any[]): Promise<ProviderResponse> {
        return {
            final_answer: '<!DOCTYPE html><html><head><title>Snake</title></head><body><canvas></canvas></body></html>'
        };
    }

    async embed(_text: string): Promise<number[]> {
        return [];
    }
}

async function run() {
    assert.deepEqual(getRequiredCapabilitiesForPlanStep({
        id: 1,
        type: 'tool',
        tool: 'workspace_save_artifact',
        input: {}
    }), ['fs_access']);

    assert.deepEqual(getRequiredCapabilitiesForPlanStep({
        id: 1,
        type: 'tool',
        tool: 'workspace_save_artifact',
        input: {},
        capabilities: { requiresDOM: true }
    }), ['fs_access', 'browser_execution']);

    const sanitized = sanitizeStep({
        id: 1,
        type: 'tool',
        tool: 'workspace_save_artifact',
        input: {},
        capabilities: { requiresDOM: 'yes' as any }
    });

    assert.equal(requiresDOM(sanitized), false);
    assert.deepEqual(sanitized.capabilities, { requiresDOM: false });

    const htmlPlan: ExecutionPlan = {
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

    const htmlRuntimeMode = resolveRuntimeModeForPlan(htmlPlan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);

    assert.equal(htmlRuntimeMode.requiresBrowserValidation, false);
    assert.equal(htmlRuntimeMode.skipRuntimeExecution, true);

    const domPlan: ExecutionPlan = {
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

    const domRuntimeMode = resolveRuntimeModeForPlan(domPlan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);

    assert.equal(domRuntimeMode.requiresBrowserValidation, true);
    assert.equal(domRuntimeMode.skipRuntimeExecution, false);

    const templatePlan = await createWebProjectTemplate.build({
        goal: 'crie um jogo da cobrinha em HTML',
        provider: new FakeProvider(),
        hasActiveProject: false,
        workspaceContext: []
    });

    const saveStep = templatePlan.steps.find(step => step.tool === 'workspace_save_artifact');
    assert.ok(saveStep);
    assert.equal(saveStep?.capabilities?.requiresDOM, false);

    console.log('All tests passed.');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
