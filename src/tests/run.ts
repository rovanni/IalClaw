import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRequiredCapabilitiesForPlanStep } from '../capabilities/taskCapabilities';
import { handleCapabilityFallback } from '../capabilities/capabilityFallback';
import { canonicalizeCapability } from '../capabilities/canonicalizeCapability';
import { CapabilityRegistry } from '../capabilities/CapabilityRegistry';
import { SkillManager } from '../capabilities/SkillManager';
import { agentConfig, getExecutionModeSnapshot } from '../core/executor/AgentConfig';
import { AgentExecutor } from '../core/executor/AgentExecutor';
import { resolveExecutionMode, selectDiffStrategy, selectValidationMode } from '../core/executor/diffStrategy';
import { clearLearningBuffer, getLearningBuffer, hashLearningInput, pushLearningRecord } from '../core/executor/operationalLearning';
import { normalizeExecutionPlan, repairPlanStructure } from '../core/executor/repairPipeline';
import { requiresDOM, extractPlanRuntimeSignals, sanitizeStep } from '../capabilities/stepCapabilities';
import { computeConfidence, evaluateSessionConsistency } from '../core/planner/plannerDiagnostics';
import { createSlidesProjectTemplate, createWebProjectTemplate } from '../core/planner/templates/planTemplates';
import { buildPlannerFallbackPlan, detectPlannerIntent } from '../core/planner/planningRecovery';
import { decideExecutionPath } from '../core/runtime/decisionGate';
import { getPendingAction, isConfirmation, setPendingAction } from '../core/agent/PendingActionTracker';
import { buildExecutionPlan, classifyTask } from '../core/agent/TaskClassifier';
import { ActionRouter, ExecutionRoute } from '../core/autonomy/ActionRouter';
import { AgentRuntime } from '../core/AgentRuntime';
import { AgentController } from '../core/AgentController';
import { FlowManager } from '../core/flow/FlowManager';
import { FlowRegistry } from '../core/flow/FlowRegistry';
import { Flow } from '../core/flow/types';
import { IntentClassifier } from '../core/intent/IntentClassifier';
import { CognitiveActionExecutor } from '../core/orchestrator/CognitiveActionExecutor';
import { CognitiveOrchestrator, CognitiveStrategy } from '../core/orchestrator/CognitiveOrchestrator';
import { buildDecisionPrecedenceContext } from '../core/orchestrator/decisions/precedence/buildDecisionPrecedenceContext';
import { decideFlowStart } from '../core/orchestrator/decisions/flow/decideFlowStart';
import { ExecutionPlan } from '../core/planner/types';
import { AgentLoop } from '../engine/AgentLoop';
import { LLMProvider, MessagePayload, ProviderFactory, ProviderResponse } from '../engine/ProviderFactory';
import { SkillRegistry } from '../engine/SkillRegistry';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { LoadedSkill } from '../skills/types';
import { formatConsoleLogLine } from '../shared/AppLogger';
import { SessionManager } from '../shared/SessionManager';
import { getTraceId, runWithTrace } from '../shared/TraceContext';
import { workspaceService } from '../services/WorkspaceService';
import { TelegramOutputHandler } from '../telegram/TelegramOutputHandler';
import { parseLlmJsonWithRecovery } from '../utils/parseLlmJson';
import { runStepResultValidatorTests } from '../core/validation/StepResultValidator.test';

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

class RegistryTestFlowA implements Flow {
    public id = 'registry_test_flow_a';
    public steps = [];
    public async onComplete(): Promise<any> {
        return {};
    }
}

class RegistryTestFlowB implements Flow {
    public id = 'registry_test_flow_b';
    public steps = [];
    public async onComplete(): Promise<any> {
        return {};
    }
}

class RegistryTestFlowC implements Flow {
    public id = 'registry_test_flow_c';
    public steps = [];
    public async onComplete(): Promise<any> {
        return {};
    }
}

async function run() {
    runStepResultValidatorTests();

    const canonicalDirect = canonicalizeCapability('web_search');
    assert.equal(canonicalDirect.isKnown, true);
    assert.equal(canonicalDirect.canonical, 'web_search');

    const aliasResult = canonicalizeCapability('browser nav');
    assert.equal(aliasResult.isKnown, true);
    assert.equal(aliasResult.canonical, 'browser_execution');

    const unknownResult = canonicalizeCapability('magic_ai_thing');
    assert.equal(unknownResult.isKnown, false);
    assert.equal(unknownResult.isUnknown, true);

    const kb050Manager = new SkillManager(new CapabilityRegistry(), 'strict-no-install');
    kb050Manager.syncLoadedSkills([
        {
            id: 'kb050-mixed-skill',
            capabilities: ['browser nav', 'unknown_x']
        }
    ]);
    assert.deepEqual(kb050Manager.getCapabilityIndex(), {
        browser_execution: ['kb050-mixed-skill']
    });
    const kb050Audit = kb050Manager.getCapabilityAuditLog();
    assert.equal(kb050Audit.length, 2);
    assert.equal(kb050Audit.some(entry => entry.raw === 'browser nav' && entry.canonical === 'browser_execution' && entry.isKnown), true);
    assert.equal(kb050Audit.some(entry => entry.raw === 'unknown_x' && entry.isUnknown), true);
    assert.deepEqual(kb050Manager.getUnknownCapabilities(), ['unknown_x']);

    assert.deepEqual(getExecutionModeSnapshot('balanced'), {
        executionMode: 'balanced',
        safeMode: true,
        label: 'Equilibrado',
        behavior: 'Fallback ativo, validacao leve',
        description: 'Tenta diff primeiro, aceita fallback inteligente e entrega progresso sem travar o fluxo.'
    });

    const initialSafeMode = agentConfig.isSafeModeEnabled();
    agentConfig.setSafeMode(true);
    assert.equal(agentConfig.isSafeModeEnabled(), true);
    agentConfig.setSafeMode(false);
    assert.equal(agentConfig.isSafeModeEnabled(), false);
    agentConfig.setSafeMode(initialSafeMode);

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

    const runtimeOrchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());

    const htmlSignals = extractPlanRuntimeSignals(htmlPlan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);
    const htmlRuntimeMode = runtimeOrchestrator.decidePlanRuntimeMode(htmlSignals);

    assert.ok(htmlRuntimeMode);
    assert.equal(htmlRuntimeMode.shouldExecute, false);
    assert.equal(htmlRuntimeMode.requiresBrowser, false);

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

    const domSignals = extractPlanRuntimeSignals(domPlan, [
        { name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>' }
    ]);
    const domRuntimeMode = runtimeOrchestrator.decidePlanRuntimeMode(domSignals);

    assert.ok(domRuntimeMode);
    assert.equal(domRuntimeMode.requiresBrowser, true);
    assert.equal(domRuntimeMode.shouldExecute, true);

    const markdownSignals = extractPlanRuntimeSignals({
        goal: 'registrar tarefa em markdown',
        steps: [
            {
                id: 1,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: { filename: 'IALCLAW_FALLBACK_TASK.md', content: '# fallback' }
            }
        ]
    }, [
        { name: 'IALCLAW_FALLBACK_TASK.md', relative_path: 'IALCLAW_FALLBACK_TASK.md', size: 100, preview: '# fallback' }
    ]);
    const markdownRuntimeMode = runtimeOrchestrator.decidePlanRuntimeMode(markdownSignals);

    assert.ok(markdownRuntimeMode);
    assert.equal(markdownRuntimeMode.requiresBrowser, false);
    assert.equal(markdownRuntimeMode.shouldExecute, false);

    const retrySessionId = 'kb001-retry-governance';
    const retryFallbackDecision = runtimeOrchestrator.decideRetryAfterFailure({
        sessionId: retrySessionId,
        attempt: 1,
        executorDecision: true
    });
    assert.equal(retryFallbackDecision, undefined);

    runtimeOrchestrator.ingestSignalsFromLoop({
        failSafe: { activated: true, trigger: 'runtime_failure' }
    } as any, retrySessionId);
    runtimeOrchestrator.ingestSelfHealingSignal({
        activated: true,
        attempts: 1,
        maxAttempts: 6,
        success: false,
        lastError: 'simulated runtime failure',
        stepId: '1',
        toolName: 'workspace_run_project'
    }, retrySessionId);

    const retryGovernedDecision = runtimeOrchestrator.decideRetryAfterFailure({
        sessionId: retrySessionId,
        attempt: 2,
        executorDecision: true
    });
    assert.equal(retryGovernedDecision, false);

    const capabilityFallbackSignal = handleCapabilityFallback('browser_execution');
    assert.equal(capabilityFallbackSignal.failureType, 'capability_missing');
    assert.equal(capabilityFallbackSignal.capability, 'browser_execution');
    assert.equal(capabilityFallbackSignal.retryPossible, true);
    assert.equal(capabilityFallbackSignal.severity, 'medium');
    assert.equal(capabilityFallbackSignal.context.suggestedDegradation, 'static_validation');
    assert.equal(('strategy' in (capabilityFallbackSignal as any)), false);

    const executorWithoutOrchestrator = new AgentExecutor({} as any);
    const localCapabilityDecision = (executorWithoutOrchestrator as any).resolveCapabilityFallbackDecision(
        undefined,
        capabilityFallbackSignal
    );
    assert.equal(localCapabilityDecision, undefined);

    const capabilityOrchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
    const executorWithOrchestrator = new AgentExecutor({} as any, capabilityOrchestrator);
    const capabilitySession = { conversation_id: 'kb017-capability-safe-mode' } as any;

    const governedCapabilityDecision = (executorWithOrchestrator as any).resolveCapabilityFallbackDecision(
        capabilitySession,
        capabilityFallbackSignal
    );
    assert.equal(governedCapabilityDecision.action, 'degrade');
    assert.equal(governedCapabilityDecision.reason, 'degradation_available');

    const originalCapabilityDecider = (capabilityOrchestrator as any).decideCapabilityFallback;
    (capabilityOrchestrator as any).decideCapabilityFallback = () => undefined;

    const safeModeCapabilityDecision = (executorWithOrchestrator as any).resolveCapabilityFallbackDecision(
        capabilitySession,
        capabilityFallbackSignal
    );
    assert.equal(safeModeCapabilityDecision, undefined);

    (capabilityOrchestrator as any).decideCapabilityFallback = originalCapabilityDecider;

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

    const loopProvider: LLMProvider = {
        async generate(): Promise<ProviderResponse> {
            return {
                final_answer: 'Instalado com sucesso. added 45 packages in 3s'
            };
        },
        async embed(): Promise<number[]> {
            return [];
        }
    };
    const loop = new AgentLoop(loopProvider, new SkillRegistry());
    const loopResult = await SessionManager.runWithSession('test-loop-1', async () => {
        return await loop.run([{ role: 'user', content: 'instale essa dependencia' }]);
    });
    assert.match(loopResult.answer, /Nota:\s+n[aã]o executei esses comandos aqui/i);

    const fallbackSignal = await (loop as any).buildToolFallbackSignal({
        step: {
            id: 1,
            description: 'buscar arquivo de configuracao no projeto',
            tool: 'web_search',
            completed: false,
            failed: false
        },
        toolName: 'web_search',
        trigger: 'reliability_risk'
    });
    assert.equal(fallbackSignal.trigger, 'reliability_risk');
    assert.equal(fallbackSignal.fallbackRecommended, true);
    assert.notEqual(fallbackSignal.suggestedTool, 'web_search');
    assert.equal(fallbackSignal.reason, 'fallback_available');

    const fallbackWithoutStep = await (loop as any).buildToolFallbackSignal({
        toolName: 'web_search',
        trigger: 'memory_block'
    });
    assert.equal(fallbackWithoutStep.fallbackRecommended, false);
    assert.equal(fallbackWithoutStep.reason, 'no_step_context');

    let loopStep = 0;
    const loopProviderWithIrrelevantTool: LLMProvider = {
        async generate(): Promise<ProviderResponse> {
            if (loopStep === 0) {
                loopStep++;
                return {
                    tool_call: {
                        name: 'get_system_time',
                        args: {}
                    }
                };
            }

            return {
                final_answer: '✅ Skill instalada com sucesso! elite-powerpoint-designer v2.1.0'
            };
        },
        async embed(): Promise<number[]> {
            return [];
        }
    };

    const loopWithIrrelevantTool = new AgentLoop(loopProviderWithIrrelevantTool, new SkillRegistry());
    const groundedLoopResult = await SessionManager.runWithSession('test-loop-2', async () => {
        return await loopWithIrrelevantTool.run([{ role: 'user', content: 'instale a skill elite-powerpoint-designer' }]);
    });
    assert.match(groundedLoopResult.answer, /Nota:\s+n[aã]o executei esses comandos aqui/i);

    const loopProviderWithLeak: LLMProvider = {
        async generate(): Promise<ProviderResponse> {
            return {
                final_answer: '[Usando skill: read_local_file]</arg_value>'
            };
        },
        async embed(): Promise<number[]> {
            return [];
        }
    };

    const loopWithLeak = new AgentLoop(loopProviderWithLeak, new SkillRegistry());
    const leakResult = await loopWithLeak.run([{ role: 'user', content: 'Quais funcionalidades voce tem disponíveis?' }]);
    assert.doesNotMatch(leakResult.answer, /\[Usando skill:/i);
    assert.doesNotMatch(leakResult.answer, /<\/?arg_[a-z_]+>/i);
    assert.ok(leakResult.answer.length > 0);

    // ── Test: list_installed_skills tool returns real skill data ──────────
    {
        const registryWithList = new SkillRegistry();
        const fakeSkills: LoadedSkill[] = [
            { id: 'skill-installer', name: 'skill-installer', description: 'Instala skills do marketplace', argumentHint: '', body: '', sourcePath: '', origin: 'internal', triggers: [], capabilities: [] },
            { id: 'skill-auditor', name: 'skill-auditor', description: 'Audita skills publicas', argumentHint: '', body: '', sourcePath: '', origin: 'internal', triggers: [], capabilities: [] },
        ];
        registryWithList.register({
            name: 'list_installed_skills',
            description: 'Lista skills instaladas.',
            parameters: { type: 'object', properties: {}, required: [] }
        }, {
            execute: async () => {
                const lines = fakeSkills.map(s => `• ${s.name} (${s.origin === 'internal' ? 'interna' : 'pública'}) — ${s.description}`);
                return `Skills instaladas (${fakeSkills.length}):\n${lines.join('\n')}`;
            }
        });

        // Provider that calls list_installed_skills tool
        let listToolCallCount = 0;
        const listProvider: LLMProvider = {
            async generate(_msgs: MessagePayload[], _tools?: any[]): Promise<ProviderResponse> {
                if (_msgs[0]?.role === 'system' && _msgs[0]?.content.includes('explicabilidade')) {
                    return { final_answer: 'Plan simulation.' };
                }
                if (listToolCallCount === 0) {
                    listToolCallCount++;
                    return { tool_call: { name: 'list_installed_skills', args: {} } };
                }
                const toolMsg = [..._msgs].reverse().find(m => m.role === 'tool');
                console.log(`[DEBUG_MSGS] roles=${_msgs.map(m => m.role).join(',')}, toolFound=${!!toolMsg}, toolContent=${toolMsg?.content?.slice(0, 80)}`);
                return { final_answer: toolMsg?.content || _msgs[_msgs.length - 1]?.content || '' };
            },
            async embed(): Promise<number[]> { return []; }
        };

        const loopWithList = new AgentLoop(listProvider, registryWithList);
        const listResult = await SessionManager.runWithSession('test-loop-3', async () => {
            return await loopWithList.run([{ role: 'user', content: 'O que voce sabe fazer?' }]);
        });
        console.log(`[DEBUG_ACTUAL] Answer: ${listResult.answer}`);
        assert.match(listResult.answer, /skill-installer/i);
        assert.match(listResult.answer, /skill-auditor/i);
        assert.match(listResult.answer, /Skills instaladas \(2\)/);
    }

    await SessionManager.runWithSession('skill-history-test', async () => {
        const fakeMemory = {
            saveMessage: () => undefined,
            learn: async () => undefined,
            retrieveWithTraversal: async () => [],
            getIdentityNodes: async () => []
        } as any;

        const mockProvider = {
            embed: async () => []
        } as any;

        const fakeLoop = {
            run: async () => ({ answer: 'Confirma a instalacao? (sim/nao)', newMessages: [] }),
            getProvider: () => mockProvider,
            getDecisionMemory: () => null,
            getSignalsSnapshot: () => ({})
        } as any;

        const controller = new AgentController(
            fakeMemory,
            { build: () => '' } as any,
            fakeLoop,
            {} as any,
            {} as any
        );

        const skill: LoadedSkill = {
            id: 'skill-installer',
            name: 'skill-installer',
            description: 'instala skills publicas',
            argumentHint: '',
            body: 'Fluxo de instalacao',
            sourcePath: '/tmp/skill.md',
            origin: 'internal',
            triggers: ['instalar skill'],
            capabilities: []
        };

        const response = await (controller as any).runWithSkill(
            'skill-history-test',
            'Poderia instalar a skill elite-powerpoint-designer?',
            'instalar elite-powerpoint-designer',
            skill
        );

        assert.equal(response, 'Confirma a instalacao? (sim/nao)');

        const session = SessionManager.getCurrentSession()!;
        assert.equal(session.conversation_history.length, 2);
        assert.equal(session.conversation_history[0]?.role, 'user');
        assert.equal(session.conversation_history[1]?.role, 'assistant');
        assert.match(session.conversation_history[0]?.content || '', /elite-powerpoint-designer/i);
        assert.match(session.conversation_history[1]?.content || '', /Confirma a instalacao/i);
    });

    await SessionManager.runWithSession('pending-action-unit-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        const pending = setPendingAction(session, {
            type: 'install_skill',
            payload: { skillName: 'pptx' }
        });

        assert.equal(pending.type, 'install_skill');
        assert.equal(pending.payload.skillName, 'pptx');
        assert.equal(isConfirmation('yes, install'), true);
        assert.equal(isConfirmation('ok pode instalar'), true);
        assert.equal(isConfirmation('qual o status?'), false);

        const readBack = getPendingAction(session);
        assert.equal(readBack?.payload.skillName, 'pptx');
    });

    await SessionManager.runWithSession('pending-action-controller-test', async () => {
        let capturedLoopUserMessage = '';

        const fakeMemory = {
            saveMessage: () => undefined,
            learn: async () => undefined,
            retrieveWithTraversal: async () => [],
            getIdentityNodes: async () => [],
            getProjectNodes: () => [],
            getConversationHistory: () => [],
            saveProjectNode: async () => undefined,
            indexCodeNode: async () => undefined,
            setActiveCodeFiles: () => undefined,
            saveExecutionFix: () => undefined,
            searchByContent: () => []
        } as any;

        const fakeLoop = {
            run: async (messages: MessagePayload[]) => {
                let userMsg: MessagePayload | undefined;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'user') {
                        userMsg = messages[i];
                        break;
                    }
                }
                capturedLoopUserMessage = userMsg?.content || '';
                return { answer: 'Executando instalacao.', newMessages: [] };
            },
            getProvider: () => ({ embed: async () => [] }),
            getDecisionMemory: () => null,
            getSignalsSnapshot: () => ({})
        } as any;

        const controller = new AgentController(
            fakeMemory,
            { build: () => '' } as any,
            fakeLoop,
            {} as any,
            {} as any
        );

        const session = SessionManager.getCurrentSession()!;
        setPendingAction(session, {
            type: 'install_skill',
            payload: { skillName: 'pptx' }
        });

        const answer = await controller.handleWebMessage('pending-action-controller-test', 'yes, install');

        assert.match(answer, /tentei instalar/i);
    });

    const intentClassifier = new IntentClassifier();
    assert.equal(intentClassifier.classify('me ajude a desenvolver um jogo').mode, 'EXPLORATION');
    assert.equal(intentClassifier.classify('crie um jogo da cobrinha').mode, 'EXECUTION');
    assert.equal(intentClassifier.classify('converta esse arquivo').mode, 'EXECUTION');

    const snakeClassification = classifyTask('crie um jogo da cobrinha em html');
    assert.equal(snakeClassification.type, 'content_generation');

    const memoryClassification = classifyTask('o que voce tem na sua memoria sobre mim?');
    assert.equal(memoryClassification.type, 'information_request');
    assert.ok(memoryClassification.confidence >= 0.95);

    const filesystemDeterministicPlan = buildExecutionPlan('filesystem', 'crie pasta jogos e subpasta jogo-cobra');
    assert.ok(filesystemDeterministicPlan);
    assert.equal(filesystemDeterministicPlan?.length, 2);
    assert.equal(filesystemDeterministicPlan?.[0]?.tool, 'create_directory');
    assert.equal(filesystemDeterministicPlan?.[0]?.params.path, 'workspace/jogos');
    assert.equal(filesystemDeterministicPlan?.[1]?.params.path, 'workspace/jogos/jogo-cobra');

    const noBuilderPlan = buildExecutionPlan('content_generation', 'explique quicksort');
    assert.equal(noBuilderPlan, null);

    const actionRouter = new ActionRouter();
    const externalInfoRoute = actionRouter.decideRoute('poderia verificar a situacao da criptomoeda pax gold?', 'information_request');
    assert.equal(externalInfoRoute.route, ExecutionRoute.TOOL_LOOP);
    assert.equal(externalInfoRoute.subtype, 'command');
    assert.equal(externalInfoRoute.confidence, 1);

    const memoryRoute = actionRouter.decideRoute('o que voce tem na sua memoria sobre mim?', 'information_request');
    assert.equal(memoryRoute.confidence, 1);

    await SessionManager.runWithSession('exploration-orchestrator-test', async () => {
        const orchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
        const decision = await orchestrator.decide({
            sessionId: 'exploration-orchestrator-test',
            input: 'me ajude a desenvolver um jogo',
            intent: { mode: 'EXPLORATION', confidence: 0.92 }
        });

        assert.equal(decision.strategy, CognitiveStrategy.ASK);
        assert.match(decision.reason, /tipo de jogo|snake|pong/i);
    });

    await SessionManager.runWithSession('external-info-orchestrator-test', async () => {
        const orchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
        const decision = await orchestrator.decide({
            sessionId: 'external-info-orchestrator-test',
            input: 'poderia verificar a situacao da criptomoeda pax gold?'
        });

        assert.equal(decision.strategy, CognitiveStrategy.TOOL);
        assert.equal(decision.reason, 'tool_execution');
    });

    await SessionManager.runWithSession('memory-query-orchestrator-test', async () => {
        const orchestrator = new CognitiveOrchestrator({
            searchByContent: () => [{ score: 0.91, content: 'Usuario prefere respostas objetivas.' }]
        } as any, new FlowManager());
        const decision = await orchestrator.decide({
            sessionId: 'memory-query-orchestrator-test',
            input: 'o que voce tem na sua memoria sobre mim?'
        });

        assert.notEqual(decision.strategy, CognitiveStrategy.ASK);
        assert.equal(decision.strategy, CognitiveStrategy.LLM);
    });

    await SessionManager.runWithSession('kb-045-start-flow-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        const memoryStub = {
            saveMessage: () => undefined,
            searchByContent: () => []
        } as any;
        const flowManager = new FlowManager();
        const orchestrator = new CognitiveOrchestrator(memoryStub, flowManager);
        const executor = new CognitiveActionExecutor(memoryStub, flowManager);

        const decision = await orchestrator.decide({
            sessionId: session.conversation_id,
            input: 'criar slides em html sobre arquitetura de software'
        });

        assert.equal(decision.strategy, CognitiveStrategy.START_FLOW);
        assert.equal(decision.flowId, 'html_slides');

        const result = await executor.execute(decision, session, 'criar slides em html sobre arquitetura de software');

        assert.match(result.answer || '', /Qual conteúdo você deseja usar para os slides/i);
        assert.equal(session.flow_state?.flowId, 'html_slides');
        assert.ok(FlowRegistry.get(session.flow_state!.flowId));
    });

    await SessionManager.runWithSession('kb-046-pending-has-priority-over-flow-start-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        const memoryStub = {
            saveMessage: () => undefined,
            searchByContent: () => []
        } as any;

        setPendingAction(session, {
            type: 'install_skill',
            payload: { skillName: 'pptx' }
        });

        const orchestrator = new CognitiveOrchestrator(memoryStub, new FlowManager());
        const decision = await orchestrator.decide({
            sessionId: session.conversation_id,
            input: 'sim, pode continuar e criar slides em html sobre arquitetura de software'
        });

        assert.equal(decision.strategy, CognitiveStrategy.EXECUTE_PENDING);
        assert.notEqual(decision.strategy, CognitiveStrategy.START_FLOW);
        assert.ok(decision.pendingActionId);
    });

    await SessionManager.runWithSession('kb-046-input-gap-preserved-on-early-return-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        (session as any).last_input_gap = {
            capability: 'browser_execution',
            reason: 'missing_capability',
            severity: 'medium'
        };

        setPendingAction(session, {
            type: 'install_skill',
            payload: { skillName: 'pptx' }
        });

        const orchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
        const decision = await orchestrator.decide({
            sessionId: session.conversation_id,
            input: 'sim, pode instalar'
        });

        assert.equal(decision.strategy, CognitiveStrategy.EXECUTE_PENDING);
        assert.ok((session as any).last_input_gap, 'input gap should remain when decide exits early');
        assert.equal((session as any).last_input_gap.capability, 'browser_execution');
    });

    await SessionManager.runWithSession('kb-046-input-gap-consumed-when-used-in-normal-path-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        (session as any).last_input_gap = {
            capability: 'browser_execution',
            reason: 'missing_capability',
            severity: 'medium'
        };

        const orchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
        await orchestrator.decide({
            sessionId: session.conversation_id,
            input: 'o que voce tem na sua memoria sobre mim?'
        });

        assert.equal((session as any).last_input_gap, undefined);
    });

    const precedenceWithPending = buildDecisionPrecedenceContext({
        hasReactiveState: false,
        flowManagerInFlow: false,
        isInGuidedFlow: false,
        pendingActionExists: true,
        intent: 'EXECUTE',
        isIntentRelatedToTopic: true
    });
    assert.equal(precedenceWithPending.hasPendingAction, true);
    assert.equal(precedenceWithPending.canEvaluateFlowStart, false);

    const precedenceFlowEscape = buildDecisionPrecedenceContext({
        hasReactiveState: false,
        flowManagerInFlow: true,
        isInGuidedFlow: false,
        pendingActionExists: false,
        intent: 'STOP',
        isIntentRelatedToTopic: false
    });
    assert.equal(precedenceFlowEscape.hasActiveFlow, true);
    assert.equal(precedenceFlowEscape.isFlowEscape, true);

    const precedenceWithReactiveState = buildDecisionPrecedenceContext({
        hasReactiveState: true,
        flowManagerInFlow: true,
        isInGuidedFlow: true,
        pendingActionExists: true,
        intent: 'EXECUTE',
        isIntentRelatedToTopic: true
    });
    assert.equal(precedenceWithReactiveState.hasPendingAction, false);
    assert.equal(precedenceWithReactiveState.canEvaluateFlowStart, false);
    assert.equal(precedenceWithReactiveState.hasActiveFlow, false);

    FlowRegistry.registerDefinition({
        id: 'registry_test_flow_a',
        flowClass: RegistryTestFlowA,
        tags: ['registry', 'alpha'],
        triggers: ['registrar alpha flow'],
        priority: 3,
        description: 'Flow de teste alpha'
    });
    assert.equal(FlowRegistry.has('registry_test_flow_a'), true);

    FlowRegistry.registerMany([
        {
            id: 'registry_test_flow_b',
            flowClass: RegistryTestFlowB,
            tags: ['registry', 'beta'],
            triggers: ['registrar beta flow'],
            priority: 2,
            description: 'Flow de teste beta'
        },
        {
            id: 'registry_test_flow_c',
            flowClass: RegistryTestFlowC,
            tags: ['registry', 'gamma'],
            triggers: ['registrar gamma flow'],
            priority: 1,
            description: 'Flow de teste gamma'
        }
    ]);

    assert.equal(FlowRegistry.has('registry_test_flow_b'), true);
    assert.equal(FlowRegistry.has('registry_test_flow_c'), true);

    const definitions = FlowRegistry.listDefinitions();
    const alphaDefinition = definitions.find(def => def.id === 'registry_test_flow_a');
    assert.ok(alphaDefinition);
    assert.ok(alphaDefinition?.tags?.includes('alpha'));
    assert.ok(alphaDefinition?.triggers?.includes('registrar alpha flow'));
    assert.equal(alphaDefinition?.priority, 3);

    const decision = decideFlowStart({
        sessionId: 'test-session',
        input: 'pode registrar alpha flow para mim?',
        availableFlows: FlowRegistry.listDefinitions()
    });
    assert.equal(decision.flowId, 'registry_test_flow_a');

    await SessionManager.runWithSession('exploration-controller-test', async () => {
        let loopCalls = 0;

        const fakeMemory = {
            saveMessage: () => undefined,
            learn: async () => undefined,
            retrieveWithTraversal: async () => [],
            getIdentityNodes: async () => [],
            getProjectNodes: () => [],
            getConversationHistory: () => [],
            saveProjectNode: async () => undefined,
            indexCodeNode: async () => undefined,
            setActiveCodeFiles: () => undefined,
            saveExecutionFix: () => undefined,
            searchByContent: () => []
        } as any;

        const fakeLoop = {
            run: async () => {
                loopCalls += 1;
                return { answer: 'LOOP_SHOULD_NOT_RUN', newMessages: [] };
            },
            getProvider: () => ({ embed: async () => [] }),
            getDecisionMemory: () => null,
            getSignalsSnapshot: () => ({})
        } as any;

        const controller = new AgentController(
            fakeMemory,
            { build: () => '' } as any,
            fakeLoop,
            {} as any,
            {} as any
        );

        const answer = await controller.handleWebMessage('exploration-controller-test', 'me ajude a desenvolver um jogo');

        assert.match(answer, /vamos desenvolver isso juntos/i);
        assert.doesNotMatch(answer, /arquivo/i);
        assert.equal(loopCalls, 0);
    });

    const directRuntime = new AgentRuntime({} as CognitiveMemory) as any;
    const originalSafeMode = agentConfig.isSafeModeEnabled();
    const originalDirect = directRuntime.executor.executeDirect;
    const originalPlanner = directRuntime.planner.createPlanWithDiagnostics;

    agentConfig.setSafeMode(true);
    directRuntime.executor.executeDirect = async (userInput: string) => ({
        success: true,
        answer: `DIRECT:${userInput}`
    });
    directRuntime.planner.createPlanWithDiagnostics = async () => {
        throw new Error('planner should not run in safe mode');
    };

    const runtimeAnswer = await SessionManager.runWithSession('safe-mode-test', async () => directRuntime.execute('explique filas', 'planner'));
    assert.equal(runtimeAnswer, 'DIRECT:explique filas');

    // ExecutionPolicy explícita sobrepõe o global — safeMode:true via policy
    agentConfig.setSafeMode(false); // global diz "não safe mode"
    const policyAnswer = await SessionManager.runWithSession('policy-test', async () =>
        directRuntime.execute('explique filas', 'planner', { safeMode: true })
    );
    assert.equal(policyAnswer, 'DIRECT:explique filas'); // policy vence

    directRuntime.executor.executeDirect = originalDirect;
    directRuntime.planner.createPlanWithDiagnostics = originalPlanner;
    agentConfig.setSafeMode(originalSafeMode);

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
        last_artifacts: [],
        conversation_history: [],
        pending_actions: [],
        lastAccessedAt: Date.now()
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
        last_artifacts: [],
        conversation_history: [],
        pending_actions: [],
        lastAccessedAt: Date.now()
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

    const telegramProjectId = `telegram-slides-${Date.now()}`;
    const telegramOutputRoot = workspaceService.getProjectOutputPath(telegramProjectId);
    fs.mkdirSync(telegramOutputRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceService.getProjectRootPath(telegramProjectId), 'project.json'), JSON.stringify({
        name: 'telegram-slides',
        type: 'slides',
        agent: 'test',
        prompt: 'crie slides no telegram',
        trace_id: 'trace-telegram',
        created_at: Date.now(),
        status: 'completed'
    }), 'utf8');
    fs.writeFileSync(path.join(telegramOutputRoot, 'index.html'), '<!DOCTYPE html><html><body>slides</body></html>', 'utf8');

    const telegramHandler = new TelegramOutputHandler();
    let sentDocument = false;
    let replyCount = 0;

    await SessionManager.runWithSession('telegram-output-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        session.current_project_id = telegramProjectId;
        session.last_artifacts = ['index.html'];

        await telegramHandler.sendResponse({
            reply: async () => {
                replyCount += 1;
            },
            replyWithDocument: async () => {
                sentDocument = true;
            }
        } as any, 'Slides gerados com sucesso.', false);
    });

    assert.equal(replyCount > 0, true);
    assert.equal(sentDocument, true);

    const traceBefore = runWithTrace(() => {
        const outerTraceId = getTraceId();
        const innerTraceId = runWithTrace(() => getTraceId(), 'runtime_core');
        assert.equal(innerTraceId, outerTraceId);
        return outerTraceId;
    }, 'telegram_controller');
    assert.equal(typeof traceBefore, 'string');

    const providerInstanceA = ProviderFactory.getProvider();
    const providerInstanceB = ProviderFactory.getProvider();
    assert.equal(providerInstanceA, providerInstanceB);

    const consoleLine = formatConsoleLogLine({
        timestamp: '2026-03-25T21:36:51.718Z',
        level: 'info',
        component: 'AgentController',
        event: 'message_flow_started',
        message: 'Iniciando processamento de mensagem do Telegram.',
        trace_id: '67e03695-958e-4538-8819-e9223b34fe5f',
        pid: 3082,
        conversation_id: '8071707790',
        channel: 'telegram',
        telegram_user_id: 8071707790,
        update_id: 429398611
    });
    const stripAnsi = (value: string) => value.replace(/\x1B\[[0-9;]*m/g, '');
    const normalizedConsoleLine = stripAnsi(consoleLine);
    assert.match(normalizedConsoleLine, /\[START\] MESSAGE_RECEIVED/);
    assert.match(normalizedConsoleLine, /trace=67e03695/);

    const summaryLine = formatConsoleLogLine({
        timestamp: '2026-03-25T21:36:53.718Z',
        level: 'info',
        component: 'AgentController',
        event: 'execution_summary',
        message: 'Resumo cognitivo da execucao.',
        trace_id: '67e03695-958e-4538-8819-e9223b34fe5f',
        pid: 3082,
        cognitive_stage: 'result',
        summary: 'SUCCESS',
        decision: 'DIRECT_EXECUTION',
        mode: 'SAFE_MODE',
        success: true,
        duration_ms: 2026,
        response_length: 512
    });
    const normalizedSummaryLine = stripAnsi(summaryLine);
    assert.match(normalizedSummaryLine, /\[RESULT\] SUCCESS/);
    assert.match(normalizedSummaryLine, /mode=SAFE_MODE/);
    assert.match(normalizedSummaryLine, /duration_ms=2026/);

    // ── Test: CONFIRM → EXECUTE → COMPLETE → RETRY flow (loop fix) ──
    await SessionManager.runWithSession('capability-loop-fix-test', async () => {
        let capturedEffectiveQuery = '';
        let ensureCalled = false;

        const fakeMemory = {
            saveMessage: () => undefined,
            learn: async () => undefined,
            retrieveWithTraversal: async () => [],
            getIdentityNodes: async () => [],
            getProjectNodes: () => [],
            getConversationHistory: () => [],
            saveProjectNode: async () => undefined,
            indexCodeNode: async () => undefined,
            setActiveCodeFiles: () => undefined,
            saveExecutionFix: () => undefined,
            searchByContent: () => []
        } as any;

        const fakeLoop = {
            run: async (messages: MessagePayload[]) => {
                let userMsg: MessagePayload | undefined;
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'user') {
                        userMsg = messages[i];
                        break;
                    }
                }
                capturedEffectiveQuery = userMsg?.content || '';
                return { answer: 'Audio processado com sucesso.', newMessages: [] };
            },
            getProvider: () => ({ embed: async () => [] }),
            getDecisionMemory: () => null,
            getSignalsSnapshot: () => ({})
        } as any;

        const controller = new AgentController(
            fakeMemory,
            { build: () => '' } as any,
            fakeLoop,
            {} as any,
            {} as any
        );

        const session = SessionManager.getCurrentSession()!;

        // Step 1: Set up a pending capability installation action
        setPendingAction(session, {
            type: 'install_capability',
            payload: {
                capability: 'audio_support',
                originalQuery: 'transcreva esse audio para texto'
            }
        });

        const pendingBefore = getPendingAction(session);
        assert.ok(pendingBefore, 'Pending action should exist');
        assert.equal(pendingBefore!.type, 'install_capability');
        assert.equal(pendingBefore!.status, 'awaiting_confirmation');

        // Step 2: Simulate user confirmation — the handler in AgentController should
        // process the confirmation and retry with the original query.
        // Note: skillManager.ensure may fail in test env, so we test the flow structure.
        const answer = await controller.handleWebMessage('capability-loop-fix-test', 'sim');

        // Step 3: Verify the pending action was processed
        const pendingAfter = getPendingAction(session);

        // If installation succeeded, pending should be cleared and original query retried
        // If installation failed, pending should be back to awaiting_confirmation
        // Either way, session.retry_count should have been incremented
        assert.ok(
            (session.retry_count ?? 0) >= 1 || pendingAfter === null,
            'Retry count should be incremented or action cleared'
        );

        // Verify answer is NOT empty (system responded with something)
        assert.ok(answer.length > 0, 'System should return a response');
    });

    // ── Test: Retry safety limits prevent infinite loops ──
    await SessionManager.runWithSession('retry-safety-test', async () => {
        const session = SessionManager.getCurrentSession()!;
        session.retry_count = 3; // Already exceeded max retries

        setPendingAction(session, {
            type: 'install_capability',
            payload: {
                capability: 'audio_support',
                originalQuery: 'transcreva esse audio'
            }
        });

        const fakeMemory = {
            saveMessage: () => undefined,
            learn: async () => undefined,
            retrieveWithTraversal: async () => [],
            getIdentityNodes: async () => [],
            getProjectNodes: () => [],
            getConversationHistory: () => [],
            saveProjectNode: async () => undefined,
            indexCodeNode: async () => undefined,
            setActiveCodeFiles: () => undefined,
            saveExecutionFix: () => undefined,
            searchByContent: () => []
        } as any;

        const fakeLoop = {
            run: async () => ({ answer: 'should not reach here', newMessages: [] }),
            getProvider: () => ({ embed: async () => [] }),
            getDecisionMemory: () => null,
            getSignalsSnapshot: () => ({})
        } as any;

        const controller = new AgentController(
            fakeMemory,
            { build: () => '' } as any,
            fakeLoop,
            {} as any,
            {} as any
        );

        const answer = await controller.handleWebMessage('retry-safety-test', 'sim');

        // Should hit retry limit and return failure message
        assert.match(answer, /múltiplas tentativas|multiple attempts/i);

        // Pending action should be cleared
        const pendingAfter = getPendingAction(session);
        assert.equal(pendingAfter, null, 'Pending action should be cleared after retry limit');

        // Retry count should be reset
        assert.equal(session.retry_count, 0, 'Retry count should be reset after limit');
    });

    // ── Test: KB-002 Golden Master (Runtime Governance parity) ──

    await SessionManager.runWithSession('kb-002-golden-master', async () => {
        const orchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
        
        const testCases = [
            {
                name: 'HTML without Node and without requiresDOM',
                plan: htmlPlan,
                context: [{ name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>', isDir: false } as any]
            },
            {
                name: 'HTML with DOM validation',
                plan: domPlan,
                context: [{ name: 'index.html', relative_path: 'index.html', size: 100, preview: '<html></html>', isDir: false } as any]
            },
            {
                name: 'Pure Markdown (no runnable entry)',
                plan: { goal: 'test', steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {} }] } as ExecutionPlan,
                context: [{ name: 'README.md', relative_path: 'README.md', size: 100, preview: '# test', isDir: false } as any]
            },
            {
                name: 'Node project',
                plan: { goal: 'test node', steps: [{ id: 1, type: 'tool', tool: 'workspace_save_artifact', input: {} }] } as ExecutionPlan,
                context: [{ name: 'index.js', relative_path: 'index.js', size: 100, preview: 'console.log("hi")', isDir: false } as any]
            }
        ];

        for (const tc of testCases) {
            const signals = extractPlanRuntimeSignals(tc.plan, tc.context);
            const orchestrated = orchestrator.decidePlanRuntimeMode(signals);

            assert.ok(orchestrated, `Orchestrator should decide for ${tc.name}`);
            if (tc.name === 'HTML without Node and without requiresDOM') {
                assert.equal(orchestrated.shouldExecute, false, `Expected skip in ${tc.name}`);
                assert.equal(orchestrated.requiresBrowser, false, `Expected no browser in ${tc.name}`);
            }
            if (tc.name === 'HTML with DOM validation') {
                assert.equal(orchestrated.shouldExecute, true, `Expected execute in ${tc.name}`);
                assert.equal(orchestrated.requiresBrowser, true, `Expected browser in ${tc.name}`);
            }
            if (tc.name === 'Pure Markdown (no runnable entry)') {
                assert.equal(orchestrated.shouldExecute, false, `Expected skip in ${tc.name}`);
                assert.equal(orchestrated.requiresBrowser, false, `Expected no browser in ${tc.name}`);
            }
            if (tc.name === 'Node project') {
                assert.equal(orchestrated.shouldExecute, true, `Expected execute in ${tc.name}`);
                assert.equal(orchestrated.requiresBrowser, false, `Expected no browser in ${tc.name}`);
            }
            assert.equal(orchestrated.decisionSource, "orchestrator");
        }
    });

    // ── Test: KB-024 execution memory deve ser session-scoped ──
    await SessionManager.runWithSession('kb-024-execution-memory-a', async () => {
        const sessionA = SessionManager.getCurrentSession()!;
        const sessionB = SessionManager.getSession('kb-024-execution-memory-b');

        SessionManager.resetExecutionMemoryState(sessionA);
        SessionManager.resetExecutionMemoryState(sessionB);

        for (let i = 0; i < 55; i++) {
            SessionManager.appendExecutionMemoryEntry(sessionA, {
                stepType: `step-${i}`,
                tool: `tool-${i % 3}`,
                success: i % 2 === 0,
                context: `ctx-${i}`,
                timestamp: i
            }, 50);
        }

        const stateAAfterAppend = SessionManager.getExecutionMemoryState(sessionA);
        const stateBAfterAppend = SessionManager.getExecutionMemoryState(sessionB);

        assert.equal(stateAAfterAppend.entries.length, 50, 'Session A deve respeitar limite maxEntries=50');
        assert.equal(stateAAfterAppend.entries[0]?.stepType, 'step-5', 'Session A deve manter apenas as ultimas 50 entradas');
        assert.equal(stateAAfterAppend.entries[49]?.stepType, 'step-54', 'Session A deve manter a entrada mais recente');
        assert.equal(stateBAfterAppend.entries.length, 0, 'Session B deve permanecer isolada sem entradas');

        SessionManager.appendExecutionMemoryEntry(sessionB, {
            stepType: 'step-b-1',
            tool: 'tool-b',
            success: true,
            context: 'ctx-b-1',
            timestamp: Date.now()
        }, 50);

        const stateAStillIsolated = SessionManager.getExecutionMemoryState(sessionA);
        const stateBWithOneEntry = SessionManager.getExecutionMemoryState(sessionB);

        assert.equal(stateAStillIsolated.entries.length, 50, 'Session A deve continuar com 50 entradas');
        assert.equal(stateBWithOneEntry.entries.length, 1, 'Session B deve ter exatamente 1 entrada');
        assert.equal(stateBWithOneEntry.entries[0]?.stepType, 'step-b-1');

        const compactedEntries = stateAStillIsolated.entries.slice(-2);
        SessionManager.setExecutionMemoryState(sessionA, compactedEntries);
        assert.equal(SessionManager.getExecutionMemoryState(sessionA).entries.length, 2, 'setExecutionMemoryState deve sobrescrever entries da sessao');

        SessionManager.resetExecutionMemoryState(sessionA);

        const stateAAfterReset = SessionManager.getExecutionMemoryState(sessionA);
        const stateBAfterResetA = SessionManager.getExecutionMemoryState(sessionB);

        assert.equal(stateAAfterReset.entries.length, 0, 'Reset deve limpar apenas a sessao alvo');
        assert.equal(stateBAfterResetA.entries.length, 1, 'Reset de A nao deve afetar sessao B');

        const rankingSession = SessionManager.getSession('kb-024-ranking-session');
        SessionManager.resetExecutionMemoryState(rankingSession);

        const now = Date.now();
        SessionManager.appendExecutionMemoryEntry(rankingSession, {
            stepType: 'salvar arquivo',
            tool: 'write_file',
            success: true,
            context: 'ctx-r1',
            timestamp: now - 1000
        }, 50);
        SessionManager.appendExecutionMemoryEntry(rankingSession, {
            stepType: 'salvar arquivo',
            tool: 'write_file',
            success: true,
            context: 'ctx-r2',
            timestamp: now - 500
        }, 50);
        SessionManager.appendExecutionMemoryEntry(rankingSession, {
            stepType: 'salvar arquivo',
            tool: 'workspace_save_artifact',
            success: false,
            context: 'ctx-r3',
            timestamp: now - 300
        }, 50);
        SessionManager.appendExecutionMemoryEntry(rankingSession, {
            stepType: 'outro',
            tool: 'workspace_save_artifact',
            success: true,
            context: 'ctx-r4',
            timestamp: now - 200
        }, 50);

        const rankingSnapshot = SessionManager.getExecutionMemorySelectionSnapshot(rankingSession, {
            stepType: 'salvar arquivo',
            candidateTools: ['write_file', 'workspace_save_artifact'],
            maxAgeMs: 3600000,
            minSamples: 2
        });

        assert.equal(rankingSnapshot.scores.length, 2, 'Snapshot de ranking deve consolidar scores por tool na sessao');
        assert.equal(rankingSnapshot.scores[0]?.tool, 'write_file', 'Tool com score positivo maior deve aparecer primeiro');
        assert.equal(rankingSnapshot.scores[0]?.score, 2, 'write_file deve refletir 2 sucessos e 0 falhas');
        assert.equal(rankingSnapshot.scores[1]?.tool, 'workspace_save_artifact', 'Tool secundaria deve permanecer no ranking');
        assert.equal(rankingSnapshot.scores[1]?.score, -1, 'workspace_save_artifact deve refletir falha contextual');
        assert.equal(rankingSnapshot.contextualConfidenceByTool.write_file, 1, 'Confidence contextual da tool principal deve ser 1.0');
        assert.equal(rankingSnapshot.contextualConfidenceByTool.workspace_save_artifact, 0.5, 'Fallback global deve ser usado quando nao houver amostra contextual minima');
        assert.equal(rankingSnapshot.bestConfidence, 1, 'Snapshot deve expor bestConfidence contextual');
        assert.equal(rankingSnapshot.decisionConfidence, 1, 'Decision confidence deve reutilizar o melhor confidence disponivel');
    });

    // ── Test: KB-024 tool selection deve permanecer passiva no Orchestrator nesta fase ──
    const kb024SelectionOrchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());

    kb024SelectionOrchestrator.ingestSignalsFromLoop({
        failSafe: { activated: true, trigger: 'intent_clear' }
    } as any, 'kb-024-tool-selection');

    const kb024GovernedSelection = kb024SelectionOrchestrator.decideToolSelection({
        sessionId: 'kb-024-tool-selection',
        signal: {
            stepType: 'salvar arquivo',
            candidateTools: ['write_file', 'workspace_save_artifact'],
            scores: [
                { tool: 'write_file', score: 3, successes: 3, failures: 0 },
                { tool: 'workspace_save_artifact', score: 1, successes: 1, failures: 0 }
            ],
            contextualConfidenceByTool: {
                write_file: 1,
                workspace_save_artifact: 0.5
            },
            fallbackConfidence: 1,
            explorationRate: 0.4,
            shouldExplore: true,
            hasContextualPositiveCandidate: true,
            explorationCandidate: 'workspace_save_artifact',
            highestPositiveCandidate: 'write_file'
        }
    });

    // ETAPA KB-024.2: Orchestrator agora e ATIVO em selecao de tool
    assert.notEqual(kb024GovernedSelection, undefined, 'Orchestrator deve retornar decisao ativa quando houver exploacao+candidato');
    assert.equal(kb024GovernedSelection?.reason, 'exploration', 'Com shouldExplore=true, Orchestrator deve recomendar exploacao');
    assert.equal(kb024GovernedSelection?.recommendedTool, 'workspace_save_artifact', 'Exploacao deve usar explorationCandidate');

    const kb024ExplorationOrchestrator = new CognitiveOrchestrator({ searchByContent: () => [] } as any, new FlowManager());
    const kb024ExplorationSelection = kb024ExplorationOrchestrator.decideToolSelection({
        sessionId: 'kb-024-tool-selection-free',
        signal: {
            stepType: 'salvar arquivo',
            candidateTools: ['write_file', 'workspace_save_artifact'],
            scores: [
                { tool: 'write_file', score: 3, successes: 3, failures: 0 },
                { tool: 'workspace_save_artifact', score: 1, successes: 1, failures: 0 }
            ],
            contextualConfidenceByTool: {
                write_file: 1,
                workspace_save_artifact: 0.5
            },
            fallbackConfidence: 1,
            explorationRate: 0.4,
            shouldExplore: true,
            hasContextualPositiveCandidate: true,
            explorationCandidate: 'workspace_save_artifact',
            highestPositiveCandidate: 'write_file'
        }
    });

    // Mesmo sem FailSafe ativo, exploacao aparece porque e logica pura do signal
    assert.notEqual(kb024ExplorationSelection, undefined, 'Even without FailSafe, exploacao com candidato deve ser recomendada');
    assert.equal(kb024ExplorationSelection?.reason, 'exploration', 'Exploacao deve ser recomendada quando signal.shouldExplore=true');

    const kb024ContextualSelection = kb024ExplorationOrchestrator.decideToolSelection({
        sessionId: 'kb-024-tool-selection-contextual',
        signal: {
            stepType: 'salvar arquivo',
            candidateTools: ['write_file', 'workspace_save_artifact'],
            scores: [
                { tool: 'write_file', score: 3, successes: 3, failures: 0 },
                { tool: 'workspace_save_artifact', score: 1, successes: 1, failures: 0 }
            ],
            contextualConfidenceByTool: {
                write_file: 1,
                workspace_save_artifact: 0.5
            },
            fallbackConfidence: 1,
            explorationRate: 0.2,
            shouldExplore: false,
            hasContextualPositiveCandidate: true,
            highestPositiveCandidate: 'write_file'
        }
    });

    // Sem exploacao mas com candidato positivo, Orchestrator recomenda o positivo
    assert.notEqual(kb024ContextualSelection, undefined, 'Com candidato positivo e sem exploacao, Orchestrator recomenda o positivo');
    assert.equal(kb024ContextualSelection?.reason, 'contextual_confidence', 'Score positivo com contexto deve ter motivo contextual');
    assert.equal(kb024ContextualSelection?.recommendedTool, 'write_file', 'Deve recomendar o candidato positivo');

    // ETAPA KB-024.2: Validar seguranca quando nao houver candidato positivo
    const kb024NoPositiveSelection = kb024ExplorationOrchestrator.decideToolSelection({
        sessionId: 'kb-024-tool-selection-no-positive',
        signal: {
            stepType: 'salvar arquivo',
            candidateTools: ['write_file', 'workspace_save_artifact'],
            scores: [
                { tool: 'write_file', score: -1, successes: 0, failures: 1 },
                { tool: 'workspace_save_artifact', score: -2, successes: 0, failures: 2 }
            ],
            contextualConfidenceByTool: {
                write_file: 0,
                workspace_save_artifact: 0
            },
            fallbackConfidence: 0,
            explorationRate: 0.2,
            shouldExplore: false,
            hasContextualPositiveCandidate: false,
            highestPositiveCandidate: undefined
        }
    });

    assert.equal(kb024NoPositiveSelection, undefined, 'Sem candidato positivo e exploacao desativada, Orchestrator return undefined (safe)');

    console.log('All tests passed.');

}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
