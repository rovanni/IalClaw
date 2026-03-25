import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRequiredCapabilitiesForPlanStep } from '../capabilities/taskCapabilities';
import { getExecutionModeSnapshot } from '../core/executor/AgentConfig';
import { resolveExecutionMode, selectDiffStrategy, selectValidationMode } from '../core/executor/diffStrategy';
import { clearLearningBuffer, getLearningBuffer, hashLearningInput, pushLearningRecord } from '../core/executor/operationalLearning';
import { normalizeExecutionPlan, repairPlanStructure } from '../core/executor/repairPipeline';
import { requiresDOM, resolveRuntimeModeForPlan, sanitizeStep } from '../capabilities/stepCapabilities';
import { computeConfidence, evaluateSessionConsistency } from '../core/planner/plannerDiagnostics';
import { createSlidesProjectTemplate, createWebProjectTemplate } from '../core/planner/templates/planTemplates';
import { buildPlannerFallbackPlan, detectPlannerIntent } from '../core/planner/planningRecovery';
import { decideExecutionPath } from '../core/runtime/decisionGate';
import { AgentRuntime } from '../core/AgentRuntime';
import { ExecutionPlan } from '../core/planner/types';
import { LLMProvider, MessagePayload, ProviderResponse } from '../engine/ProviderFactory';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { SessionManager } from '../shared/SessionManager';
import { workspaceService } from '../services/WorkspaceService';
import { parseLlmJsonWithRecovery } from '../utils/parseLlmJson';

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
    assert.deepEqual(getExecutionModeSnapshot('balanced'), {
        executionMode: 'balanced',
        label: 'Equilibrado',
        behavior: 'Fallback ativo, validacao leve',
        description: 'Tenta diff primeiro, aceita fallback inteligente e entrega progresso sem travar o fluxo.'
    });

    assert.equal(resolveExecutionMode('strict', 0.2), 'strict');
    assert.equal(resolveExecutionMode('balanced', 0.9), 'balanced');
    assert.equal(resolveExecutionMode('balanced', 0.3), 'aggressive');

    assert.equal(selectDiffStrategy({
        confidence: 0.2,
        fileExists: true,
        changeSizeEstimate: 'large',
        errorContext: true,
        executionMode: 'strict'
    }), 'diff');

    assert.equal(selectDiffStrategy({
        confidence: 0.9,
        fileExists: true,
        changeSizeEstimate: 'small',
        executionMode: 'aggressive'
    }), 'overwrite');

    assert.equal(selectValidationMode('strict'), 'hard');
    assert.equal(selectValidationMode('balanced'), 'soft');
    assert.equal(selectValidationMode('aggressive'), 'minimal');

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

    const slidesPlan = await createSlidesProjectTemplate.build({
        goal: 'crie slides interativos em HTML para programacao desktop',
        provider: new FakeProvider(),
        hasActiveProject: false,
        workspaceContext: []
    });

    assert.equal(slidesPlan.steps[0]?.tool, 'workspace_create_project');
    assert.equal(slidesPlan.steps[0]?.input.type, 'slides');

    const slidesSaveStep = slidesPlan.steps.find(step => step.tool === 'workspace_save_artifact');
    assert.ok(slidesSaveStep);
    assert.equal(slidesSaveStep?.capabilities?.requiresDOM, false);

    const repairedObject = parseLlmJsonWithRecovery<{ goal: string; steps: Array<{ id: number }> }>(`\n\`\`\`json\n{"goal":"teste","steps":[{"id":1,}],\n\`\`\``);
    assert.equal(repairedObject.value.goal, 'teste');
    assert.equal(repairedObject.value.steps[0]?.id, 1);
    assert.equal(repairedObject.meta.repaired, true);
    assert.equal(repairedObject.meta.removedTrailingCommas, true);
    assert.equal(repairedObject.meta.balancedClosers, true);

    const repairedArray = parseLlmJsonWithRecovery<Array<{ id: number }>>('[{"id":1},{"id":2');
    assert.equal(repairedArray.value.length, 2);
    assert.equal(repairedArray.meta.repaired, true);
    assert.equal(repairedArray.meta.truncatedLikely, true);

    const detectedSlides = detectPlannerIntent('crie slides interativos sobre arquitetura de software');
    assert.equal(detectedSlides.projectType, 'slides');

    const detectedAutomation = detectPlannerIntent('crie um bot de automacao para baixar relatorios');
    assert.equal(detectedAutomation.projectType, 'automation');

    const fallbackWithoutProject = buildPlannerFallbackPlan('crie uma landing page para um produto SaaS', false, 'planner_parse_failed');
    assert.equal(fallbackWithoutProject.steps[0]?.tool, 'workspace_create_project');
    assert.equal(fallbackWithoutProject.steps[1]?.tool, 'workspace_save_artifact');

    const fallbackWithProject = buildPlannerFallbackPlan('corrija o projeto atual', true, 'planner_validation_failed');
    assert.equal(fallbackWithProject.steps.length, 1);
    assert.equal(fallbackWithProject.steps[0]?.tool, 'workspace_save_artifact');

    const confidenceHigh = computeConfidence({
        parseRecovered: false,
        validationPassed: true,
        hallucinatedToolDetected: false,
        sessionConsistency: 0.9,
        fileTargetConfidence: 0.8
    });
    assert.ok(Math.abs(confidenceHigh - 0.72) < 1e-9);

    const confidenceLow = computeConfidence({
        parseRecovered: true,
        validationPassed: false,
        hallucinatedToolDetected: true,
        sessionConsistency: 0.4,
        fileTargetConfidence: 0.5
    });
    assert.ok(Math.abs(confidenceLow - 0.02) < 1e-9);

    const consistentSession = evaluateSessionConsistency('corrija o dashboard atual', 'corrija o dashboard atual', true);
    assert.ok(consistentSession >= 0.9);

    const decisionPlan = decideExecutionPath({
        plan: htmlPlan,
        diagnostics: {
            parseRecovered: false,
            validationPassed: true,
            hallucinatedToolDetected: false,
            sessionConsistency: 1,
            fileTargetConfidence: 1,
            confidenceScore: 0.85
        }
    }, 'strict');
    assert.equal(decisionPlan, 'PLAN_EXECUTION');

    const decisionRepair = decideExecutionPath({
        plan: htmlPlan,
        diagnostics: {
            parseRecovered: true,
            validationPassed: true,
            hallucinatedToolDetected: false,
            sessionConsistency: 0.8,
            fileTargetConfidence: 0.8,
            confidenceScore: 0.55
        }
    }, 'balanced');
    assert.equal(decisionRepair, 'REPAIR_AND_EXECUTE');

    const decisionDirect = decideExecutionPath({
        diagnostics: {
            parseRecovered: true,
            validationPassed: false,
            hallucinatedToolDetected: true,
            sessionConsistency: 0.3,
            fileTargetConfidence: 0.2,
            confidenceScore: 0.15
        }
    }, 'aggressive');
    assert.equal(decisionDirect, 'DIRECT_EXECUTION');

    const normalizedPlan = normalizeExecutionPlan({
        goal: 'corrigir app',
        steps: [
            {
                id: 9,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: {},
                capabilities: { requiresDOM: 'yes' as any }
            }
        ]
    });
    assert.equal(normalizedPlan.steps[0]?.id, 1);
    assert.equal(normalizedPlan.steps[0]?.capabilities?.requiresDOM, false);

    const repairedActivePlan = repairPlanStructure({
        goal: 'corrigir projeto ativo',
        steps: [
            {
                id: 1,
                type: 'tool',
                tool: 'workspace_create_project',
                input: { name: 'novo', type: 'code', prompt: 'novo' }
            },
            {
                id: 2,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: { filename: 'index.html', content: '<html></html>' }
            }
        ]
    }, {
        conversation_id: 'c1',
        current_project_id: 'demo-123',
        last_artifacts: []
    });
    assert.equal(repairedActivePlan.success, true);
    assert.ok(repairedActivePlan.repairActions.includes('remove_workspace_create_project_for_active_session'));
    assert.equal(repairedActivePlan.repairedPlan?.steps[0]?.tool, 'workspace_save_artifact');

    const repairedInactivePlan = repairPlanStructure({
        goal: 'criar app novo',
        steps: [
            {
                id: 2,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: { filename: 'index.html', content: '<html></html>' }
            }
        ]
    }, {
        conversation_id: 'c2',
        current_goal: 'criar app novo',
        last_artifacts: []
    });
    assert.equal(repairedInactivePlan.success, true);
    assert.ok(repairedInactivePlan.repairActions.includes('inject_workspace_create_project'));
    assert.equal(repairedInactivePlan.repairedPlan?.steps[0]?.tool, 'workspace_create_project');

    clearLearningBuffer();
    pushLearningRecord({
        inputHash: hashLearningInput('teste'),
        decision: 'REPAIR_AND_EXECUTE',
        confidence: 0.42,
        success: true,
        repairActions: ['normalize_plan']
    });
    const learningBuffer = getLearningBuffer();
    assert.equal(learningBuffer.length, 1);
    assert.equal(learningBuffer[0]?.decision, 'REPAIR_AND_EXECUTE');
    assert.equal(learningBuffer[0]?.inputHash.length, 40);

    const runtime = new AgentRuntime({} as CognitiveMemory) as any;
    const testProjectId = `slides-test-${Date.now()}`;
    const projectRoot = workspaceService.getProjectRootPath(testProjectId);
    fs.mkdirSync(path.join(projectRoot, 'output'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({
        name: 'slides-test',
        type: 'slides',
        agent: 'test',
        prompt: 'crie slides',
        trace_id: 'trace-test',
        created_at: Date.now(),
        status: 'completed'
    }), 'utf8');

    const successMessage = SessionManager.runWithSession('runtime-test', () => {
        const session = SessionManager.getCurrentSession()!;
        session.current_project_id = testProjectId;
        session.last_artifacts = ['index.html'];

        return runtime.buildExecutionSuccessMessage({
            goal: 'crie slides para aula',
            steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {} }]
        }, session);
    });

    assert.match(successMessage, /Slides gerados com sucesso\./);
    assert.match(successMessage, new RegExp(testProjectId));
    assert.match(successMessage, /index\.html/);

    console.log('All tests passed.');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
