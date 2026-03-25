import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlidesProjectTemplate, createWebProjectTemplate } from '../core/planner/templates/planTemplates';
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

test('template web para snake nao marca requiresDOM', async () => {
    const plan = await createWebProjectTemplate.build({
        goal: 'crie um jogo da cobrinha em HTML',
        provider: new FakeProvider(),
        hasActiveProject: false,
        workspaceContext: []
    });

    const saveStep = plan.steps.find(step => step.tool === 'workspace_save_artifact');
    assert.ok(saveStep);
    assert.equal(saveStep?.capabilities?.requiresDOM, false);
});

test('template de slides cria projeto do tipo slides sem requiresDOM', async () => {
    const plan = await createSlidesProjectTemplate.build({
        goal: 'crie slides interativos em HTML para aula de programacao desktop',
        provider: new FakeProvider(),
        hasActiveProject: false,
        workspaceContext: []
    });

    assert.equal(plan.steps[0]?.tool, 'workspace_create_project');
    assert.equal(plan.steps[0]?.input.type, 'slides');

    const saveStep = plan.steps.find(step => step.tool === 'workspace_save_artifact');
    assert.ok(saveStep);
    assert.equal(saveStep?.capabilities?.requiresDOM, false);
});
