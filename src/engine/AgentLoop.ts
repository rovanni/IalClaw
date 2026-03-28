import { LLMProvider, MessagePayload } from './ProviderFactory';
import { SkillRegistry } from './SkillRegistry';
import { createLogger } from '../shared/AppLogger';
import { emitDebug } from '../shared/DebugBus';
import { t } from '../i18n';
import { classifyTask, getForcedPlanForTaskType, TaskType } from '../core/agent/TaskClassifier';
import { StepValidator, ValidationContext } from './StepValidator';
import { ToolReliability } from './ToolReliability';
import { ResultEvaluator } from './ResultEvaluator';

export type AgentProgressEvent = {
    stage:
    | 'loop_started'
    | 'iteration_started'
    | 'llm_started'
    | 'llm_completed'
    | 'tool_started'
    | 'tool_completed'
    | 'tool_failed'
    | 'finalizing'
    | 'completed'
    | 'stopped'
    | 'failed'
    | 'planning'
    | 'executing_step';
    iteration?: number;
    tool_name?: string;
    duration_ms?: number;
};

export type ExecutionStep = {
    id: number;
    description: string;
    tool?: string;
    completed: boolean;
    failed: boolean;
    error?: string;
    result?: string;
};

export type ExecutionPlan = {
    goal: string;
    steps: ExecutionStep[];
    currentStepIndex: number;
    createdAt: number;
    triedPaths: string[];
    failedTools: Map<string, number>;
};

export type ExecutionContext = {
    currentPlan: ExecutionPlan | null;
    pathsTried: Set<string>;
    toolsFailed: Map<string, number>;
    lastToolResult: string | null;
};

export type StepValidation = {
    success: boolean;
    confidence: number;
    reason: string;
    needsLlm: boolean;
};

export type ExecutionMemoryEntry = {
    stepType: string;
    tool: string;
    success: boolean;
    context: string;
    timestamp: number;
};

export type ToolScore = {
    tool: string;
    score: number;
    successes: number;
    failures: number;
};

const EXECUTION_CLAIM_PATTERNS: RegExp[] = [
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

const INSTALL_SUCCESS_CLAIM_PATTERNS: RegExp[] = [
    /\bskill\s+instalad[oa]\s+com\s+sucesso\b/i,
    /\binstalad[oa]\s+com\s+sucesso\b/i,
    /\binstalled\s+successfully\b/i,
    /\badded\s+\d+\s+packages\b/i
];

const INSTALL_EVIDENCE_PATTERNS: RegExp[] = [
    /OK:\s*(SKILL\.md|skill\.json|README\.md)\s+salvo\s+em\s+skills\/public\//i,
    /skills\/public\/[a-z0-9\-_]+\//i,
    /auditoria\s+(aprovada|concluida\s+com\s+sucesso)/i,
    /added\s+\d+\s+packages/i
];

const STEP_TOOL_MAPPING: Record<string, string[]> = {
    'localizar arquivo': ['list_directory', 'search_file', 'read_local_file'],
    'buscar arquivo': ['list_directory', 'search_file', 'read_local_file'],
    'procurar arquivo': ['list_directory', 'search_file'],
    'listar diretório': ['list_directory'],
    'ler arquivo': ['read_local_file'],
    'ler conteúdo': ['read_local_file'],
    'escrever arquivo': ['write_file'],
    'salvar arquivo': ['write_file'],
    'criar arquivo': ['write_file'],
    'criar diretório': ['create_directory'],
    'deletar arquivo': ['delete_file'],
    'remover arquivo': ['delete_file'],
    'mover arquivo': ['move_file'],
    'renomear arquivo': ['move_file'],
    'buscar na web': ['web_search'],
    'pesquisar': ['web_search'],
    'buscar URL': ['fetch_url'],
    'obter hora': ['get_system_time'],
    'instalar skill': ['write_skill_file', 'promote_skill_temp'],
    'auditar skill': ['run_skill_auditor'],
    'verificar skill': ['read_audit_log'],
};

export type AgentMode = 'THINKING' | 'EXECUTION';

export const TASK_TOOL_MAP: Record<string, string[]> = {
    'file_conversion': ['list_directory', 'read_local_file', 'file.convert'],
    'file_search': ['list_directory', 'search_file', 'read_local_file'],
    'content_generation': ['workspace_create_project', 'workspace_save_artifact'],
    'system_operation': ['system.exec', 'run_command'],
    'web_search': ['web_search', 'fetch_url'],
};

export class AgentLoop {
    private llm: LLMProvider;
    private registry: SkillRegistry;
    private maxIterations = 4;
    private logger = createLogger('AgentLoop');
    private executionContext: ExecutionContext = {
        currentPlan: null,
        pathsTried: new Set(),
        toolsFailed: new Map(),
        lastToolResult: null
    };
    private executionMemory: ExecutionMemoryEntry[] = [];
    private readonly MAX_MEMORY_ENTRIES = 50;
    private originalInput: string = '';
    private currentTaskType: TaskType | null = null;
    private currentTaskConfidence: number = 0;
    private stepValidations: number[] = [];
    private reclassificationAttempts: number = 0;
    private readonly MAX_RECLASSIFY_ATTEMPTS = 1;
    private readonly LOW_CONFIDENCE_THRESHOLD = 0.85;
    private readonly STEP_CONFIDENCE_THRESHOLD = 0.5;
    private readonly GLOBAL_CONFIDENCE_THRESHOLD = 0.8;
    private readonly MAX_STEPS_BEFORE_OVEREXECUTION_CHECK = 4;
    private lastStepResult: string = '';
    private mode: AgentMode = 'THINKING';
    private disableFollowUpQuestions: boolean = false;
    private actionTaken: boolean = false;
    private refinementUsed: boolean = false;
    private readonly QUALITY_THRESHOLD = 0.5;
    
    private readonly MODE_TRANSITION_CONFIDENCE = 0.75;
    
    // Delta detection for marginal improvement
    private previousConfidence: number | null = null;
    private lowImprovementCount = 0;
    private readonly MIN_DELTA_THRESHOLD = 0.05;
    private readonly MAX_LOW_IMPROVEMENTS = 2;

    constructor(llm: LLMProvider, registry: SkillRegistry) {
        this.llm = llm;
        this.registry = registry;
    }

    public getProvider(): LLMProvider {
        return this.llm;
    }

    private evaluateModeTransition(): void {
        if (this.mode === 'EXECUTION') return;
        
        const confidence = this.currentTaskConfidence;
        const classified = this.currentTaskType !== null && this.currentTaskType !== 'unknown';
        
        if (confidence >= this.MODE_TRANSITION_CONFIDENCE && classified) {
            this.mode = 'EXECUTION';
            this.disableFollowUpQuestions = true;
            this.logger.info('mode_transition', `[MODE] Transicionando para EXECUTION: confidence=${confidence.toFixed(2)}, type=${this.currentTaskType}`);
        }
    }

    private ensureMinimalPlan(): void {
        if (this.executionContext.currentPlan && this.executionContext.currentPlan.steps.length > 0) return;
        
        if (!this.currentTaskType || this.currentTaskType === 'unknown') {
            this.executionContext.currentPlan = {
                goal: this.originalInput,
                steps: [{ id: 1, description: 'processar entrada do usuário', completed: false, failed: false }],
                currentStepIndex: 0,
                createdAt: Date.now(),
                triedPaths: [],
                failedTools: new Map()
            };
            return;
        }
        
        const forcedPlan = getForcedPlanForTaskType(this.currentTaskType);
        if (forcedPlan) {
            const steps = forcedPlan.map((desc, idx) => ({
                id: idx + 1,
                description: desc,
                completed: false,
                failed: false
            }));
            
            this.executionContext.currentPlan = {
                goal: this.originalInput,
                steps,
                currentStepIndex: 0,
                createdAt: Date.now(),
                triedPaths: [],
                failedTools: new Map()
            };
            
            this.logger.info('minimal_plan_created', `[PLAN] Plano mínimo criado para: ${this.currentTaskType}`);
        }
    }

    private executeNextStep(plan: ExecutionPlan): void {
        if (plan.currentStepIndex >= plan.steps.length) return;
        
        const step = plan.steps[plan.currentStepIndex];
        if (!step.tool) {
            step.tool = this.mapStepToTool(step.description);
        }
        
        this.logger.info('forced_step_execution', `[EXECUTE] Forçando execução do step: ${step.description} (tool: ${step.tool || 'none'})`);
    }

    public async run(initialMessages: MessagePayload[], policy?: any): Promise<{ answer: string, newMessages: MessagePayload[] }> {
        const maxIter = policy?.limits?.max_steps || this.maxIterations;
        const maxTools = policy?.limits?.max_tool_calls || 3;
        const timeoutMs = 30000; // 30 segundos
        let toolCallsCount = 0;
        let consecutiveToolFailures = 0;
        const toolEvidence: string[] = [];
        const startedAt = Date.now();
        let lastToolName: string | null = null;
        let toolRepeatCount = 0;
        let totalResponseLength = 0;

        let toolsDefinition = this.registry.getDefinitions();

        // Apply policy to tools
        if (policy?.tool_policy) {
            toolsDefinition = toolsDefinition.filter(t => {
                if (policy.tool_policy.deny?.includes(t.name)) return false;
                if (policy.tool_policy.allow && policy.tool_policy.allow.length > 0) {
                    return policy.tool_policy.allow.includes(t.name);
                }
                return true;
            });

            const priority = policy.tool_policy.priority || [];
            if (priority.length > 0) {
                toolsDefinition.sort((a, b) => {
                    const idxA = priority.indexOf(a.name);
                    const idxB = priority.indexOf(b.name);
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }
        }

        let messages = [...initialMessages];
        const newMessages: MessagePayload[] = [];
        
        const userInput = initialMessages.filter(m => m.role === 'user').pop()?.content || '';
        this.setOriginalInput(userInput);
        
        this.evaluateModeTransition();
        
        this.ensureMinimalPlan();
        
        if (this.currentTaskType && ['file_conversion', 'file_search', 'content_generation'].includes(this.currentTaskType)) {
            const workspaceHint: MessagePayload = {
                role: 'system',
                content: `[WORKSPACE] Tarefa de arquivo detectada (${this.currentTaskType}). Prepare o workspace automaticamente se necessário.`
            };
            messages.push(workspaceHint);
        }
        
        messages = this.addPlanningGuidanceToMessages(messages, policy);
        
        const progressCb = typeof policy?.progress?.onEvent === 'function'
            ? policy.progress.onEvent as ((event: AgentProgressEvent) => Promise<void> | void)
            : undefined;
        const shouldStop = typeof policy?.control?.shouldStop === 'function'
            ? policy.control.shouldStop as (() => boolean)
            : undefined;

        const emitProgress = async (event: AgentProgressEvent) => {
            if (!progressCb) return;
            try {
                await progressCb(event);
            } catch {
                // Non-critical: progresso não pode interromper o loop principal
            }
        };

        const stopIfRequested = async (): Promise<boolean> => {
            if (!shouldStop || !shouldStop()) {
                return false;
            }

            const stoppedAnswer = t('loop.stopped_by_user');
            const finalMsg: MessagePayload = { role: 'assistant', content: stoppedAnswer };
            newMessages.push(finalMsg);
            await emitProgress({ stage: 'stopped' });
            this.logger.warn('loop_stopped_by_user', t('log.loop.stopped_by_user'));
            return true;
        };

        this.logger.info('loop_started', t('log.loop.started'), {
            initial_messages: initialMessages.length,
            max_iterations: maxIter,
            max_tools: maxTools,
            available_tools: toolsDefinition.length
        });
        await emitProgress({ stage: 'loop_started' });

        if (await stopIfRequested()) {
            return { answer: t('loop.stopped_by_user'), newMessages };
        }

        for (let i = 0; i < maxIter; i++) {
            if (await stopIfRequested()) {
                return { answer: t('loop.stopped_by_user'), newMessages };
            }

            // Verificar timeout global
            const elapsedTime = Date.now() - startedAt;
            if (elapsedTime > timeoutMs) {
                this.logger.warn('loop_timeout', t('log.loop.timeout'), {
                    elapsed_ms: elapsedTime,
                    timeout_ms: timeoutMs
                });
                break;
            }

this.logger.debug('iteration_started', t('log.loop.iteration_started'), {
                iteration: i + 1,
                message_count: messages.length,
                tool_calls_count: toolCallsCount
            });
            await emitProgress({ stage: 'iteration_started', iteration: i + 1 });
            
            if (this.executionContext.currentPlan) {
                this.logCurrentPlan();
                await emitProgress({ stage: 'executing_step', iteration: i + 1 });
            }
            
            await emitProgress({ stage: 'llm_started', iteration: i + 1 });
            const response = await this.llm.generate(messages, toolsDefinition);
            await emitProgress({ stage: 'llm_completed', iteration: i + 1 });
            
            if (!this.executionContext.currentPlan && response.final_answer) {
                const plan = this.createPlanFromLLMResponse(response, messages);
                if (plan) {
                    this.logger.info('plan_parsed', '[PLAN] Plano estruturado detectado e criado', {
                        goal: plan.goal,
                        steps: plan.steps.length
                    });
                }
            }

            if (await stopIfRequested()) {
                return { answer: t('loop.stopped_by_user'), newMessages };
            }

            if (response.tool_call) {
                if (lastToolName === response.tool_call.name) {
                    toolRepeatCount++;
                    if (toolRepeatCount >= 2) {
                        this.logger.warn('tool_loop_detected', t('log.loop.tool_loop_detected'), {
                            tool_name: response.tool_call.name,
                            repeat_count: toolRepeatCount
                        });
                        
                        const plan = this.executionContext.currentPlan;
                        const fallbackStep = plan && plan.currentStepIndex < plan.steps.length
                            ? plan.steps[plan.currentStepIndex]
                            : undefined;
                        const fallbackTool = fallbackStep?.tool 
                            ? this.getFallbackToolForStep(fallbackStep)
                            : undefined;
                        if (fallbackTool && plan) {
                            if (fallbackStep) {
                                fallbackStep.tool = fallbackTool;
                                this.logger.info('forced_tool_change', `[LOOP] Forçando ferramenta alternativa: ${fallbackTool}`);
                            }
                        }
                        
                        const loopMsg: MessagePayload = {
                            role: 'system',
                            content: `MUDANÇA FORÇADA:_tool=${response.tool_call.name}_repetida_2x._Tente_ferramenta_diferente_ou_mude_estratégia._Plano_atual=${this.executionContext.currentPlan?.goal}`
                        };
                        messages.push(loopMsg);
                        toolRepeatCount = 0;
                    }
                } else {
                    lastToolName = response.tool_call.name;
                    toolRepeatCount = 1;
                }

                if (toolCallsCount >= maxTools) {
                    const blockMsg: MessagePayload = { role: 'tool', content: `[POLICY ENGINE] Tool call limite reached. Max: ${maxTools}` };
                    const assistBlock: MessagePayload = { role: 'assistant', content: `[Tentei executar ${response.tool_call.name} mas fui bloqueado pela Policy de limites]` };
                    messages.push(assistBlock, blockMsg);
                    newMessages.push(assistBlock, blockMsg);
                    this.logger.warn('tool_call_blocked', t('log.loop.tool_call_blocked'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        max_tools: maxTools
                    });
                    continue; // Pushes model to finalize answer
                }

                    toolCallsCount++;
                try {
                    const plan = this.executionContext.currentPlan;
                    const currentStepForValidation = plan && plan.currentStepIndex < plan.steps.length
                        ? plan.steps[plan.currentStepIndex]
                        : undefined;
                    const validationContext: ValidationContext = {
                        safeMode: policy?.security?.safeMode ?? false,
                        currentPlan: plan ?? undefined
                    };
                    
                    if (currentStepForValidation) {
                        const stepValidation = StepValidator.validate(currentStepForValidation, validationContext);
                        if (!stepValidation.plausible || stepValidation.risk === "high") {
                            this.logger.warn('step_validation_failed', `[VALIDATION] Step skipped: ${stepValidation.reason}`);
                            const skipMsg: MessagePayload = { role: 'tool', content: `[VALIDATION] Step skipped due to: ${stepValidation.reason}` };
                            messages.push(skipMsg);
                            continue;
                        }
                    }

                    const toolName = response.tool_call.name;
                    const contextKey = `${this.currentTaskType || 'unknown'}:${currentStepForValidation?.description || ''}`;

                    if (this.executionContext.toolsFailed.has(toolName)) {
                        this.logger.warn('tool_loop_prevented', `[LOOP] Tool já falhou: ${toolName}`);
                        const loopMsg: MessagePayload = { role: 'tool', content: `[LOOP] Tool ${toolName} already failed, selecting alternative` };
                        messages.push(loopMsg);
                        
                        const fallbackTool = currentStepForValidation 
                            ? this.getFallbackToolForStep(currentStepForValidation)
                            : undefined;

                        if (fallbackTool && fallbackTool !== toolName && this.isToolCompatible(currentStepForValidation!, fallbackTool)) {
                            this.logger.info('tool_fallback_loop', `[FALLBACK] ${toolName} → ${fallbackTool}`);
                            response.tool_call.name = fallbackTool;
                        } else {
                            continue;
                        }
                    }
                    
                    if (ToolReliability.shouldAvoid(toolName, contextKey)) {
                        const fallbackTool = currentStepForValidation 
                            ? this.getFallbackToolForStep(currentStepForValidation)
                            : undefined;

                        if (fallbackTool && fallbackTool !== toolName && this.isToolCompatible(currentStepForValidation!, fallbackTool)) {
                            this.logger.info('tool_fallback', `[FALLBACK] ${toolName} → ${fallbackTool}`);
                            response.tool_call.name = fallbackTool;
                        } else {
                            this.logger.warn('fallback_failed', `[FALLBACK] Nenhuma alternativa válida para ${toolName}`);
                            const avoidMsg: MessagePayload = { role: 'tool', content: `[RELIABILITY] Tool ${toolName} skipped - no fallback available` };
                            messages.push(avoidMsg);
                            continue;
                        }
                    }
                    
                    this.logger.info('tool_call_started', t('log.loop.tool_call_started'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        tool_calls_count: toolCallsCount
                    });
                    await emitProgress({ stage: 'tool_started', iteration: i + 1, tool_name: response.tool_call.name });
                    let result = await this.registry.executeTool(response.tool_call.name, response.tool_call.args);
                    
                    const execPlan = this.executionContext.currentPlan;
                    const execStep = execPlan && execPlan.currentStepIndex < execPlan.steps.length
                        ? execPlan.steps[execPlan.currentStepIndex]
                        : undefined;
                    
                    const evaluation = ResultEvaluator.evaluate(result);
                    const recordContext = `${this.currentTaskType || 'unknown'}:${execStep?.description || ''}`;
                    
                    ToolReliability.record(response.tool_call.name, evaluation.success, recordContext);
                    
                    if (evaluation.quality < this.QUALITY_THRESHOLD && !this.refinementUsed) {
                        this.refinementUsed = true;
                        
                        const refinedResult = await this.retryWithBetterParams(execStep, response.tool_call.args);
                        
                        if (refinedResult) {
                            this.logger.info('refinement_success', '[REFINE] Active refinement completed successfully');
                            result = refinedResult;
                            const newEvaluation = ResultEvaluator.evaluate(result);
                            ToolReliability.record(response.tool_call.name, newEvaluation.success, recordContext);
                        } else {
                            this.logger.warn('refinement_failed', '[REFINE] Active refinement failed, using original result');
                        }
                    }
                    
                    toolEvidence.push(String(result).slice(0, 2000));
                    consecutiveToolFailures = 0;

                    const assistantMsg: MessagePayload = {
                        role: 'assistant',
                        content: '',
                        tool_name: response.tool_call.name,
                        tool_args: response.tool_call.args
                    };
                    const toolMsg: MessagePayload = { role: 'tool', content: result };

                    messages.push(assistantMsg, toolMsg);
                    newMessages.push(assistantMsg, toolMsg);

                    this.logger.info('tool_call_completed', t('log.loop.tool_call_completed'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        result_length: result.length
                    });
                    await emitProgress({ stage: 'tool_completed', iteration: i + 1, tool_name: response.tool_call.name });
                    
                    if (execStep) {
                        const validation = this.validateStepResult(execStep, result, response.tool_call.name);
                        this.logValidation(execStep, validation);
                        
                        this.stepValidations.push(validation.confidence);
                        this.actionTaken = true;
                        
                        if (!validation.success) {
                            this.markCurrentStepFailed(validation.reason);
                            
                            if (this.shouldReclassify(consecutiveToolFailures)) {
                                messages = this.reclassifyAndAdjustPlan(messages);
                            }
                            
                            if (this.shouldRetryWithLlm(validation, consecutiveToolFailures)) {
                                const llmCheck: MessagePayload = {
                                    role: 'system',
                                    content: `[VALIDAÇÃO] O step "${execStep.description}" pode ter falhado: ${validation.reason}. Verifique se o resultado está correto e ajuste a estratégia se necessário.`
                                };
                                messages.push(llmCheck);
                            } else if (!validation.needsLlm) {
                                messages = this.adjustPlanAfterFailure(messages, execStep, validation);
                            }
                        }
                        
                        this.registerExecutionMemory(
                            execStep,
                            response.tool_call.name,
                            validation.success,
                            validation.reason
                        );
                    }
                    
                    if (response.tool_call.args?.path) {
                        this.recordPathTried(response.tool_call.args.path);
                    }
                    
                    this.lastStepResult = result;
                    this.advanceToNextStep();

                    const stepCount = this.executionContext.currentPlan?.currentStepIndex || 0;
                    const lastSuccessful = evaluation.success;
                    const globalConf = this.getGlobalConfidence(this.stepValidations);
                    
                    if (this.mode === 'EXECUTION' && !lastSuccessful && globalConf < this.GLOBAL_CONFIDENCE_THRESHOLD) {
                        const fallbackHint: MessagePayload = {
                            role: 'system',
                            content: `[CONFIANÇA BAIXA] Tentativa não bem-sucedida. Tente FERRAMENTA ALTERNATIVA ou mude de estratégia. Não pare.`
                        };
                        messages.push(fallbackHint);
                        this.logger.info('low_confidence_action', `[ACTION] Confiança baixa=${globalConf.toFixed(2)}. Forçando tentativa alternativa.`);
                    } else if (lastSuccessful) {
                        const stopDecision = this.shouldStopExecution(lastSuccessful, stepCount);
                        if (stopDecision.shouldStop) {
                            this.logger.info('execution_stopped', `[STOP] ${stopDecision.reason} global_confidence=${globalConf.toFixed(2)}`);
                            break;
                        }
                    }

                    const deltaStopDecision = this.checkDeltaAndStop(stepCount);
                    if (deltaStopDecision.shouldStop && this.mode !== 'EXECUTION') {
                        this.logger.info('execution_stopped_delta', `[STOP] ${deltaStopDecision.reason} global_confidence=${globalConf.toFixed(2)}`);
                        break;
                    } else if (deltaStopDecision.shouldStop && this.mode === 'EXECUTION') {
                        const forceMsg: MessagePayload = {
                            role: 'system',
                            content: `[MODO EXECUTION] Melhoria marginal detectada. Continue executando com a melhor ferramenta disponível.`
                        };
                        messages.push(forceMsg);
                        this.logger.info('delta_forced_continue', `[EXECUTION] Forçando continuidade após delta stop.`);
                    }

                    if (await stopIfRequested()) {
                        return { answer: t('loop.stopped_by_user'), newMessages };
                    }

                    continue;
} catch (error: any) {
                    this.logger.error('tool_call_failed', error, t('log.loop.tool_call_failed'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name
                    });
                    await emitProgress({ stage: 'tool_failed', iteration: i + 1, tool_name: response.tool_call.name });
                    
                    this.recordToolFailure(response.tool_call.name);
                    this.markCurrentStepFailed(error.message);
                    
                    const currentStepForMem = this.executionContext.currentPlan?.steps[this.executionContext.currentPlan.currentStepIndex];
                    if (currentStepForMem) {
                        this.registerExecutionMemory(
                            currentStepForMem,
                            response.tool_call.name,
                            false,
                            `Exceção: ${error.message}`
                        );
                    }
                    
                    const errMsg: MessagePayload = { role: 'tool', content: t('loop.tool_execution_error', { message: error.message }) };
                    messages.push(errMsg);
                    newMessages.push(errMsg);
                    consecutiveToolFailures++;

                    if (this.shouldUseFallbackStrategy()) {
                        messages = this.addFallbackStrategyHint(messages);
                    }

                    if (consecutiveToolFailures >= 2) {
                        const fallbackHint: MessagePayload = {
                            role: 'system',
                            content: t('loop.system.multiple_tool_failures')
                        };
                        messages.push(fallbackHint);
                    }
                    continue;
                }
            }

            if (response.final_answer) {
                await emitProgress({ stage: 'finalizing', iteration: i + 1 });
                const sanitizedAnswer = this.sanitizeUserFacingAnswer(response.final_answer);
                const safeAnswer = this.applyExecutionClaimGuard(sanitizedAnswer, toolCallsCount, toolEvidence);
                const finalMsg: MessagePayload = { role: 'assistant', content: safeAnswer };
                messages.push(finalMsg);
                newMessages.push(finalMsg);
                const duration = Date.now() - startedAt;
                this.logger.info('loop_completed', t('log.loop.completed'), {
                    duration_ms: duration,
                    iterations_used: i + 1,
                    tool_calls_count: toolCallsCount,
                    answer_length: safeAnswer.length
                });
                await emitProgress({ stage: 'completed', iteration: i + 1, duration_ms: duration });
                this.logMemoryStats();
                return { answer: safeAnswer, newMessages };
            }

            // Parada inteligente: se já há conteúdo suficiente acumulado
            totalResponseLength += (response.final_answer || '').length;
            if (totalResponseLength > 500 && toolCallsCount > 0) {
                this.logger.info('loop_smart_stop', t('log.loop.smart_stop'), {
                    total_response_length: totalResponseLength,
                    tool_calls: toolCallsCount
                });
                break;
            }
        }

        // Graceful fallback: pedir ao LLM uma resposta final sem tools
        this.logger.warn('loop_max_iterations_fallback', t('log.loop.max_iterations_fallback'), {
            duration_ms: Date.now() - startedAt,
            max_iterations: maxIter,
            tool_calls_count: toolCallsCount
        });

        messages.push({
            role: 'system',
            content: t('loop.system.max_iterations')
        });

        try {
            await emitProgress({ stage: 'finalizing' });
            const fallbackResponse = await this.llm.generate(messages, []);
            const fallbackAnswer = fallbackResponse.final_answer || t('loop.fallback.default_answer');
            const sanitized = this.sanitizeUserFacingAnswer(fallbackAnswer);
            const finalMsg: MessagePayload = { role: 'assistant', content: sanitized };
            newMessages.push(finalMsg);
            const duration = Date.now() - startedAt;
            this.logger.info('loop_completed_via_fallback', t('log.loop.completed_fallback'), {
                duration_ms: duration,
                answer_length: sanitized.length
            });
await emitProgress({ stage: 'completed', duration_ms: duration });
            this.logMemoryStats();
            return { answer: sanitized, newMessages };
        } catch (fallbackError: any) {
            this.logger.error('loop_fallback_failed', fallbackError, t('log.loop.fallback_failed'), {
                duration_ms: Date.now() - startedAt
            });
            await emitProgress({ stage: 'failed' });
            this.logMemoryStats();
            return { answer: t('loop.fallback.default_answer'), newMessages };
        }
    }

    private applyExecutionClaimGuard(answer: string, toolCallsCount: number, toolEvidence: string[]): string {
        if (!this.hasExecutionClaim(answer)) {
            return answer;
        }

        if (toolCallsCount > 0 && this.hasGroundingEvidence(answer, toolEvidence)) {
            return answer;
        }

        emitDebug('execution_claim_blocked', {
            reason: toolCallsCount > 0 ? 'missing_grounding_evidence' : 'no_tool_call',
            response_preview: answer.slice(0, 200)
        });

        return this.injectRealityCheck(answer);
    }

    private hasExecutionClaim(text: string): boolean {
        return EXECUTION_CLAIM_PATTERNS.some(pattern => pattern.test(text));
    }

    private hasGroundingEvidence(answer: string, toolEvidence: string[]): boolean {
        const evidenceBlob = toolEvidence.join('\n');

        const claimsInstallSuccess = INSTALL_SUCCESS_CLAIM_PATTERNS.some(pattern => pattern.test(answer));
        if (claimsInstallSuccess) {
            return INSTALL_EVIDENCE_PATTERNS.some(pattern => pattern.test(evidenceBlob));
        }

        return toolEvidence.length > 0;
    }

    private injectRealityCheck(answer: string): string {
        const suffix = t('loop.reality_check_suffix');
        return `${answer.trimEnd()}${suffix}`;
    }

private sanitizeUserFacingAnswer(answer: string): string {
        let cleaned = answer;

        // Remove vazamento de marcadores internos de tool-call e residuos XML-like do parser.
        cleaned = cleaned.replace(/\[Usando skill:[^\]]*\]/gi, '');
        cleaned = cleaned.replace(/<\/?arg_[a-z_]+>/gi, '');
        cleaned = cleaned.replace(/<\/?tool_call[^>]*>/gi, '');
        cleaned = cleaned.replace(/<\/?function[^>]*>/gi, '');
        cleaned = cleaned.trim();

        if (!cleaned) {
            return t('loop.empty_sanitized_answer');
        }

        return cleaned;
    }

    private createPlanFromLLMResponse(response: any, messages: MessagePayload[]): ExecutionPlan | null {
        const content = response.final_answer || '';
        
        const goalMatch = content.match(/goal[:\s]+["']?([^"\n]+)["']?/i);
        const stepsMatch = content.match(/steps[:\s]*\n?((?:\d+[.)]\s*[^"\n]+\n?)+)/i);
        
        if (!goalMatch || !stepsMatch) {
            return null;
        }
        
        const goal = goalMatch[1].trim();
        const stepLines = stepsMatch[1].split('\n').filter((l: string) => l.trim());
        const steps: ExecutionStep[] = stepLines.map((line: string, idx: number) => {
            const desc = line.replace(/^\d+[.)]\s*/, '').trim();
            return {
                id: idx + 1,
                description: desc,
                tool: this.mapStepToTool(desc),
                completed: false,
                failed: false
            };
        });
        
        const plan: ExecutionPlan = {
            goal,
            steps,
            currentStepIndex: 0,
            createdAt: Date.now(),
            triedPaths: [],
            failedTools: new Map()
        };
        
        this.executionContext.currentPlan = plan;
        this.executionContext.pathsTried.clear();
        this.executionContext.toolsFailed.clear();
        
        this.logger.info('plan_created', `[PLAN] Goal: ${goal}`, {
            step_count: steps.length,
            steps: steps.map((s: ExecutionStep) => s.description).join(' → ')
        });
        
        return plan;
    }

    private mapStepToTool(stepDescription: string): string | undefined {
        const lowerDesc = stepDescription.toLowerCase();
        
        for (const [key, tools] of Object.entries(STEP_TOOL_MAPPING)) {
            if (lowerDesc.includes(key)) {
                const bestFromMemory = this.getBestToolForStep(stepDescription, tools);
                if (bestFromMemory) {
                    return bestFromMemory;
                }
                
                for (const tool of tools) {
                    const failCount = this.executionContext.toolsFailed.get(tool) || 0;
                    if (failCount < 2) {
                        return tool;
                    }
                }
                return tools[0];
            }
        }
        return undefined;
    }

    private getNextStepFromLLM(messages: MessagePayload[], currentPlan: ExecutionPlan): ExecutionStep | null {
        if (currentPlan.currentStepIndex >= currentPlan.steps.length) {
            return null;
        }
        return currentPlan.steps[currentPlan.currentStepIndex];
    }

    private getFallbackToolForStep(step: ExecutionStep): string | undefined {
        const lowerDesc = step.description.toLowerCase();
        
        for (const [key, tools] of Object.entries(STEP_TOOL_MAPPING)) {
            if (lowerDesc.includes(key)) {
                const ranked = this.rankToolsForStep(step, tools);

                for (const tool of ranked) {
                    if (this.executionContext.toolsFailed.has(tool)) continue;
                    if (!this.isToolCompatible(step, tool)) continue;
                    return tool;
                }

                return ranked[0];
            }
        }
        return undefined;
    }

    private isToolCompatible(step: ExecutionStep, tool: string): boolean {
        const desc = step.description.toLowerCase();

        if (desc.includes("ler") && !tool.includes("read")) return false;
        if (desc.includes("arquivo") && tool.includes("web")) return false;
        if (desc.includes("salvar") && !tool.includes("write")) return false;
        if (desc.includes("buscar") && !(tool.includes("search") || tool.includes("web"))) return false;

        return true;
    }

    private rankToolsForStep(step: ExecutionStep, tools: string[]): string[] {
        const contextKey = `${this.currentTaskType || 'unknown'}:${step.description}`;

        return tools
            .map(tool => {
                const reliability = ToolReliability.score(tool, contextKey);
                const compatible = this.isToolCompatible(step, tool) ? 1 : 0;
                const failurePenalty = this.executionContext.toolsFailed.has(tool) ? -0.5 : 0;
                const score = (reliability * 0.6) + (compatible * 0.4) + failurePenalty;
                return { tool, score };
            })
            .sort((a, b) => b.score - a.score)
            .map(t => t.tool);
    }

    private adaptArgsForRetry(step: ExecutionStep, originalArgs?: Record<string, any>): Record<string, any> {
        return {
            ...originalArgs,
            improved: true,
            timestamp: Date.now()
        };
    }

    private async retryWithBetterParams(step: ExecutionStep | undefined, originalArgs?: Record<string, any>): Promise<string | null> {
        if (!step) {
            return null;
        }

        const fallbackTool = step.tool ? this.getFallbackToolForStep(step) : undefined;

        if (fallbackTool && fallbackTool !== step.tool) {
            this.logger.info('refinement_tool_switch', `[REFINE] ${step.tool} → ${fallbackTool}`);
            try {
                return await this.registry.executeTool(fallbackTool, this.adaptArgsForRetry(step, originalArgs));
            } catch (error) {
                this.logger.error('refinement_tool_error', error as Error, '[REFINE] Fallback tool execution failed');
                return null;
            }
        }

        if (step.tool) {
            this.logger.info('refinement_retry_same', `[REFINE] Retrying same tool ${step.tool} with improved params`);
            try {
                return await this.registry.executeTool(step.tool, this.adaptArgsForRetry(step, originalArgs));
            } catch (error) {
                this.logger.error('refinement_retry_error', error as Error, '[REFINE] Same tool retry failed');
                return null;
            }
        }

        return null;
    }

    private recordPathTried(path: string) {
        this.executionContext.pathsTried.add(path);
        if (this.executionContext.currentPlan) {
            this.executionContext.currentPlan.triedPaths.push(path);
        }
    }

    private recordToolFailure(toolName: string) {
        const count = (this.executionContext.toolsFailed.get(toolName) || 0) + 1;
        this.executionContext.toolsFailed.set(toolName, count);
        
        if (this.executionContext.currentPlan) {
            this.executionContext.currentPlan.failedTools.set(toolName, count);
        }
    }

    private isPathTried(path: string): boolean {
        return this.executionContext.pathsTried.has(path);
    }

    private hasToolFailedTooManyTimes(toolName: string): boolean {
        const count = this.executionContext.toolsFailed.get(toolName) || 0;
        return count >= 2;
    }

    private logCurrentPlan() {
        const plan = this.executionContext.currentPlan;
        if (!plan) return;
        
        let logMsg = `[PLAN] ${plan.goal}\n`;
        plan.steps.forEach((step, idx) => {
            const marker = idx === plan.currentStepIndex ? '→ ' : idx < plan.currentStepIndex ? '✓ ' : '  ';
            const status = step.completed ? '✓' : step.failed ? '✗' : '';
            logMsg += `${marker}[STEP ${step.id}] ${step.description} ${status}\n`;
        });
        
        this.logger.debug('plan_progress', logMsg);
    }

    private addPlanningGuidanceToMessages(messages: MessagePayload[], policy?: any): MessagePayload[] {
        const taskType = policy?.taskType;
        const taskConfidence = policy?.taskConfidence;
        
        let taskGuidance = '';
        if (taskType && taskConfidence && taskConfidence > 0.5) {
            switch (taskType) {
                case 'file_conversion':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Conversão de arquivo]
Plano forçado para conversões:
1. Localizar arquivo de origem
2. Ler conteúdo do arquivo  
3. Converter conteúdo
4. Salvar resultado`;
                    break;
                case 'file_search':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Busca de arquivo]
Plano forçado para buscas:
1. Determinar localização de busca
2. Buscar arquivo
3. Retornar resultado`;
                    break;
                case 'content_generation':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Geração de conteúdo]
Plano forçado:
1. Definir estrutura do conteúdo
2. Gerar conteúdo
3. Salvar conteúdo`;
                    break;
                case 'system_operation':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Operação de sistema]
Plano forçado:
1. Verificar pré-requisitos
2. Executar operação
3. Verificar resultado`;
                    break;
            }
        }

        const guidance: MessagePayload = {
            role: 'system',
            content: `Sempre crie um plano estruturado ANTES de usar ferramentas. 
O plano deve seguir este formato:
{
  "goal": "descrição clara do objetivo",
  "steps": [
    "descrição do passo 1",
    "descrição do passo 2",
    ...
  ]
}

Execute passo a passo. Escolha a ferramenta certa para cada etapa.
Se uma ferramenta falhar, adapte a estratégia ao invés de repetir a mesma ação.
SEMPRE verifique se o resultado de cada ação atende ao objetivo antes de continuar.
Evite loops usando o histórico de caminhos já tentados: ${Array.from(this.executionContext.pathsTried).join(', ') || 'nenhum'}
Evite ferramentas que já falharam: ${Array.from(this.executionContext.toolsFailed.entries()).map(([k, v]) => `${k}(${v}x)`).join(', ') || 'nenhuma'}${taskGuidance}`
        };
        
        return [...messages, guidance];
    }

    private advanceToNextStep() {
        if (this.executionContext.currentPlan) {
            const currentIdx = this.executionContext.currentPlan.currentStepIndex;
            if (currentIdx < this.executionContext.currentPlan.steps.length) {
                this.executionContext.currentPlan.steps[currentIdx].completed = true;
            }
            this.executionContext.currentPlan.currentStepIndex++;
            this.logCurrentPlan();
        }
    }

    private markCurrentStepFailed(error: string) {
        if (this.executionContext.currentPlan) {
            const currentIdx = this.executionContext.currentPlan.currentStepIndex;
            if (currentIdx < this.executionContext.currentPlan.steps.length) {
                this.executionContext.currentPlan.steps[currentIdx].failed = true;
                this.executionContext.currentPlan.steps[currentIdx].error = error;
            }
        }
    }

    private shouldReclassify(consecutiveFailures: number): boolean {
        if (this.reclassificationAttempts >= this.MAX_RECLASSIFY_ATTEMPTS) {
            return false;
        }

        if (consecutiveFailures >= 2) {
            return true;
        }

        if (this.stepValidations.length > 0) {
            const avgConfidence = this.stepValidations.reduce((a, b) => a + b, 0) / this.stepValidations.length;
            if (avgConfidence < this.STEP_CONFIDENCE_THRESHOLD && this.stepValidations.length >= 2) {
                return true;
            }
        }

        return false;
    }

    private reclassifyAndAdjustPlan(messages: MessagePayload[]): MessagePayload[] {
        if (!this.originalInput || this.reclassificationAttempts >= this.MAX_RECLASSIFY_ATTEMPTS) {
            return messages;
        }

        const newClassification = classifyTask(this.originalInput);
        const oldType = this.currentTaskType;

        if (newClassification.type === oldType || newClassification.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
            return messages;
        }

        this.reclassificationAttempts++;
        this.currentTaskType = newClassification.type;

        this.logger.info('task_reclassification', `[RECLASSIFY] old=${oldType} new=${newClassification.type} confidence=${newClassification.confidence.toFixed(2)}`);

        const forcedPlan = getForcedPlanForTaskType(newClassification.type);
        if (forcedPlan && this.executionContext.currentPlan) {
            const newSteps = forcedPlan.map((desc, idx) => ({
                id: idx + 1,
                description: desc,
                completed: false,
                failed: false
            }));

            this.executionContext.currentPlan.steps = newSteps;
            this.executionContext.currentPlan.currentStepIndex = 0;

            this.logger.info('plan_adjusted', `[PLAN] Plano ajustado para: ${newClassification.type}`);
        }

        this.stepValidations = [];
        this.resetDeltaDetection();
        
        const hint: MessagePayload = {
            role: 'system',
            content: `[TAREFA RECLASSIFICADA] O tipo de tarefa foi corrigido de "${oldType}" para "${newClassification.type}". Novo plano aplicado. Continue a execução com esta nova orientação.`
        };

        return [...messages, hint];
    }

    public setOriginalInput(input: string) {
        this.originalInput = input;
        const classification = classifyTask(input);
        this.currentTaskType = classification.type;
        this.currentTaskConfidence = classification.confidence;
        
        if (classification.confidence >= this.MODE_TRANSITION_CONFIDENCE && this.currentTaskType !== 'unknown') {
            this.mode = 'EXECUTION';
            this.disableFollowUpQuestions = true;
            this.logger.info('execution_mode_ready', `[MODE] Modo EXECUTION ativado: type=${this.currentTaskType}, confidence=${classification.confidence.toFixed(2)}`);
        } else if (classification.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
            this.logger.info('uncertain_task', `[CLASSIFIER] Tarefa incerta detectada: ${classification.type} (confidence: ${classification.confidence.toFixed(2)})`);
        }
    }

    private getGlobalConfidence(validations: number[]): number {
        if (validations.length === 0) {
            return 0;
        }

        const total = validations.reduce((sum, v) => sum + v, 0);
        return total / validations.length;
    }

    private shouldStopExecution(lastStepSuccessful: boolean, stepCount: number): { shouldStop: boolean; reason: string } {
        if (stepCount < 2) {
            return { shouldStop: false, reason: 'insufficient_steps' };
        }

        const globalConfidence = this.getGlobalConfidence(this.stepValidations);

        if (globalConfidence >= this.GLOBAL_CONFIDENCE_THRESHOLD && lastStepSuccessful) {
            return { 
                shouldStop: true, 
                reason: `global_confidence=${globalConfidence.toFixed(2)}_threshold=${this.GLOBAL_CONFIDENCE_THRESHOLD}` 
            };
        }

        if (stepCount >= this.MAX_STEPS_BEFORE_OVEREXECUTION_CHECK) {
            const recentValidations = this.stepValidations.slice(-3);
            if (recentValidations.length >= 2) {
                const avgRecent = recentValidations.reduce((a, b) => a + b, 0) / recentValidations.length;
                if (avgRecent < 0.4) {
                    return { 
                        shouldStop: true, 
                        reason: `over_execution_detected_avg_recent=${avgRecent.toFixed(2)}` 
                    };
                }
            }
        }

        return { shouldStop: false, reason: 'execution_continues' };
    }

    private checkDeltaAndStop(stepIndex: number): { shouldStop: boolean; reason: string } {
        if (stepIndex < 2) {
            return { shouldStop: false, reason: 'insufficient_steps_for_delta' };
        }

        if (this.stepValidations.length < 2) {
            return { shouldStop: false, reason: 'insufficient_validations_for_delta' };
        }

        const recent = this.stepValidations.slice(-3);
        const currentConfidence = recent.reduce((a, b) => a + b, 0) / recent.length;

        if (typeof currentConfidence !== 'number') {
            return { shouldStop: false, reason: 'invalid_confidence' };
        }

        if (this.previousConfidence !== null) {
            const delta = currentConfidence - this.previousConfidence;

            console.log(`[DELTA] avg_current=${currentConfidence.toFixed(2)} prev=${this.previousConfidence?.toFixed(2) ?? 'null'} delta=${delta.toFixed(3)}`);

            if (delta < this.MIN_DELTA_THRESHOLD) {
                this.lowImprovementCount++;
            } else {
                this.lowImprovementCount = 0;
            }
        }

        this.previousConfidence = currentConfidence;

        if (this.lowImprovementCount >= this.MAX_LOW_IMPROVEMENTS) {
            console.log(`[STOP] low improvement detected (${this.lowImprovementCount} steps)`);
            return { 
                shouldStop: true, 
                reason: `low_improvement_delta_count=${this.lowImprovementCount}` 
            };
        }

        return { shouldStop: false, reason: 'delta_check_continues' };
    }

    private resetDeltaDetection() {
        this.previousConfidence = null;
        this.lowImprovementCount = 0;
    }

    private shouldUseFallbackStrategy(): boolean {
        const failedCount = Array.from(this.executionContext.toolsFailed.values()).reduce((a, b) => a + b, 0);
        return failedCount >= 2;
    }

    private addFallbackStrategyHint(messages: MessagePayload[]): MessagePayload[] {
        const hint: MessagePayload = {
            role: 'system',
            content: `STRATÉGIA: Múltiplas ferramentas falharam. Considere:
1. Usar uma ferramenta diferente para a mesma tarefa
2. Mudar o caminho/approach
3. Usar o LLM para processar conteúdo diretamente (sem ferramenta)
4. Pedir mais informações ao usuário`
        };
        
        return [...messages, hint];
    }

    private validateStepResult(step: ExecutionStep, result: string, toolName: string): StepValidation {
        const lowerDesc = step.description.toLowerCase();
        const resultLower = result.toLowerCase();
        
        if (resultLower.includes('erro:') || resultLower.includes('error:') || resultLower.includes('failed')) {
            return { success: false, confidence: 1.0, reason: `Erro na execução: ${result.slice(0, 100)}`, needsLlm: false };
        }
        
        if (lowerDesc.includes('localizar') || lowerDesc.includes('buscar arquivo') || lowerDesc.includes('procurar')) {
            const found = !resultLower.includes('não encontrado') && 
                         !resultLower.includes('not found') && 
                         !resultLower.includes('não localizei') &&
                         result.length > 10;
            return {
                success: found,
                confidence: found ? 0.9 : 0.95,
                reason: found ? 'Arquivo/localizado encontrado no resultado' : 'Arquivo não encontrado no resultado',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('ler arquivo') || lowerDesc.includes('ler conteúdo')) {
            const hasContent = result.length > 0 && !resultLower.includes('erro');
            return {
                success: hasContent,
                confidence: hasContent ? 0.85 : 0.95,
                reason: hasContent ? 'Conteúdo lido com sucesso' : 'Falha ao ler conteúdo',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('salvar') || lowerDesc.includes('escrever') || lowerDesc.includes('criar arquivo')) {
            const saved = resultLower.includes('salvo') || 
                         resultLower.includes('success') || 
                         resultLower.includes('criado');
            return {
                success: saved,
                confidence: saved ? 0.9 : 0.8,
                reason: saved ? 'Arquivo salvo/criado com sucesso' : 'Não foi possível confirmar salvamento',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('criar diretório') || lowerDesc.includes('criar pasta')) {
            const created = resultLower.includes('criado') || 
                           resultLower.includes('success') ||
                           resultLower.includes('já existe');
            return {
                success: created,
                confidence: created ? 0.9 : 0.8,
                reason: created ? 'Diretório criado ou já existe' : 'Falha ao criar diretório',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('listar') || lowerDesc.includes('list directory')) {
            const hasList = result.includes('📁') || result.includes('📄') || result.length > 5;
            return {
                success: hasList,
                confidence: hasList ? 0.9 : 0.8,
                reason: hasList ? 'Lista de diretório obtida' : 'Falha ao listar diretório',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('deletar') || lowerDesc.includes('remover')) {
            const deleted = resultLower.includes('removido') || 
                          resultLower.includes('deletado') ||
                          resultLower.includes('deleted');
            return {
                success: deleted,
                confidence: deleted ? 0.9 : 0.8,
                reason: deleted ? 'Item removido com sucesso' : 'Falha ao remover item',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('buscar na web') || lowerDesc.includes('pesquisar')) {
            const hasResults = result.length > 20 && !resultLower.includes('nenhum resultado');
            return {
                success: hasResults,
                confidence: hasResults ? 0.8 : 0.7,
                reason: hasResults ? 'Resultados de busca obtidos' : 'Nenhum resultado encontrado',
                needsLlm: false
            };
        }
        
        if (lowerDesc.includes('converter') || lowerDesc.includes('transformar')) {
            const hasOutput = result.length > 0 && result.length < 50000;
            return {
                success: hasOutput,
                confidence: 0.7,
                reason: hasOutput ? 'Conversão realizada' : 'Falha na conversão',
                needsLlm: true
            };
        }
        
        return { success: true, confidence: 0.5, reason: 'Validação padrão aplicada', needsLlm: false };
    }

    private logValidation(step: ExecutionStep, validation: StepValidation) {
        const icon = validation.success ? '✓' : '✗';
        this.logger.debug('step_validation', `[CHECK] Step: ${step.description}`, {
            success: validation.success,
            confidence: validation.confidence,
            reason: validation.reason,
            needs_llm: validation.needsLlm
        });
    }

    private adjustPlanAfterFailure(messages: MessagePayload[], step: ExecutionStep, validation: StepValidation): MessagePayload[] {
        const hint: MessagePayload = {
            role: 'system',
            content: `[FALHA DETECTADA] Step "${step.description}" falhou: ${validation.reason}
Considere:
1. Ajustar o próximo step para corrigir o problema
2. Usar ferramenta diferente
3. Mudar estratégia entirely`
        };
        return [...messages, hint];
    }

    private shouldRetryWithLlm(validation: StepValidation, consecutiveFailures: number): boolean {
        return validation.needsLlm && !validation.success && consecutiveFailures < 2;
    }

    private getStepType(stepDescription: string): string {
        const lower = stepDescription.toLowerCase();
        if (lower.includes('ler')) return 'ler arquivo';
        if (lower.includes('salvar') || lower.includes('escrever') || lower.includes('criar arquivo')) return 'salvar arquivo';
        if (lower.includes('localizar') || lower.includes('buscar') || lower.includes('procurar')) return 'localizar arquivo';
        if (lower.includes('listar')) return 'listar diretório';
        if (lower.includes('deletar') || lower.includes('remover')) return 'deletar arquivo';
        if (lower.includes('mover') || lower.includes('renomear')) return 'mover arquivo';
        if (lower.includes('web') || lower.includes('pesquisar')) return 'buscar web';
        if (lower.includes('converter') || lower.includes('transformar')) return 'converter';
        return 'outro';
    }

    private registerExecutionMemory(step: ExecutionStep, tool: string, success: boolean, context: string = '') {
        const entry: ExecutionMemoryEntry = {
            stepType: this.getStepType(step.description),
            tool,
            success,
            context,
            timestamp: Date.now()
        };
        
        this.executionMemory.push(entry);
        
        if (this.executionMemory.length > this.MAX_MEMORY_ENTRIES) {
            this.executionMemory.shift();
        }
        
        const status = success ? 'sucesso' : 'falha';
        this.logger.debug('execution_memory', `[LEARNING] ${tool} → ${status} para step "${step.description}"`, {
            stepType: entry.stepType,
            totalEntries: this.executionMemory.length
        });
    }

    private getToolScores(stepType: string): ToolScore[] {
        const recentMemory = this.executionMemory.filter(
            e => e.stepType === stepType && Date.now() - e.timestamp < 3600000
        );
        
        const toolStats = new Map<string, { success: number; failure: number }>();
        
        for (const entry of recentMemory) {
            const stats = toolStats.get(entry.tool) || { success: 0, failure: 0 };
            if (entry.success) {
                stats.success++;
            } else {
                stats.failure++;
            }
            toolStats.set(entry.tool, stats);
        }
        
        const scores: ToolScore[] = [];
        toolStats.forEach((stats, tool) => {
            scores.push({
                tool,
                score: stats.success - stats.failure,
                successes: stats.success,
                failures: stats.failure
            });
        });
        
        return scores.sort((a, b) => b.score - a.score);
    }

    private static readonly EXPLORATION_RATE_HIGH = 0.4;
    private static readonly EXPLORATION_RATE_MEDIUM = 0.2;
    private static readonly EXPLORATION_RATE_LOW = 0.05;
    private static readonly CONFIDENCE_HIGH = 0.8;
    private static readonly CONFIDENCE_MEDIUM = 0.5;
    private static readonly MIN_CONTEXTUAL_SAMPLES = 2;

    private getContextualConfidence(stepType: string, tool: string): { confidence: number; isContextual: boolean } {
        const recentMemory = this.executionMemory.filter(
            e => e.stepType === stepType && e.tool === tool && Date.now() - e.timestamp < 3600000
        );

        if (recentMemory.length >= AgentLoop.MIN_CONTEXTUAL_SAMPLES) {
            const successes = recentMemory.filter(e => e.success).length;
            const confidence = successes / recentMemory.length;
            
            this.logger.debug('confidence', `[CONFIDENCE] step=${stepType} tool=${tool} contextual_samples=${recentMemory.length} rate=${confidence.toFixed(2)}`);
            
            return { confidence, isContextual: true };
        }

        const globalMemory = this.executionMemory.filter(
            e => e.tool === tool && Date.now() - e.timestamp < 3600000
        );

        if (globalMemory.length >= AgentLoop.MIN_CONTEXTUAL_SAMPLES) {
            const successes = globalMemory.filter(e => e.success).length;
            const confidence = successes / globalMemory.length;
            
            this.logger.debug('confidence', `[CONFIDENCE] step=${stepType} tool=${tool} global_samples=${globalMemory.length} rate=${confidence.toFixed(2)} (fallback)`);
            
            return { confidence, isContextual: false };
        }

        return { confidence: 0, isContextual: false };
    }

    private getDecisionConfidence(stepType: string, scores: ToolScore[]): number {
        if (scores.length === 0) {
            return 0;
        }

        const bestScore = scores[0];
        if (!bestScore) {
            return 0;
        }

        const { confidence, isContextual } = this.getContextualConfidence(stepType, bestScore.tool);
        
        if (confidence > 0) {
            return confidence;
        }

        const totalAttempts = bestScore.successes + bestScore.failures;
        if (totalAttempts === 0) {
            return 0;
        }

        return bestScore.successes / totalAttempts;
    }

    private getAdaptiveExplorationRate(confidence: number): number {
        if (confidence >= AgentLoop.CONFIDENCE_HIGH) {
            return AgentLoop.EXPLORATION_RATE_LOW;
        } else if (confidence >= AgentLoop.CONFIDENCE_MEDIUM) {
            return AgentLoop.EXPLORATION_RATE_MEDIUM;
        } else {
            return AgentLoop.EXPLORATION_RATE_HIGH;
        }
    }

    private getBestToolForStep(stepDescription: string, candidateTools: string[]): string | null {
        const stepType = this.getStepType(stepDescription);
        const scores = this.getToolScores(stepType);
        
        if (scores.length === 0) {
            return null;
        }

        let bestCandidate = candidateTools[0];
        let bestConfidence = 0;
        
        for (const candidate of candidateTools) {
            const scoreEntry = scores.find(s => s.tool === candidate);
            if (scoreEntry && scoreEntry.score > 0) {
                const { confidence } = this.getContextualConfidence(stepType, candidate);
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    bestCandidate = candidate;
                }
            }
        }
        
        const decisionConfidence = bestConfidence > 0 ? bestConfidence : this.getDecisionConfidence(stepType, scores);
        const explorationRate = this.getAdaptiveExplorationRate(decisionConfidence);
        
        const shouldExplore = candidateTools.length > 1 && Math.random() < explorationRate;
        
        if (shouldExplore) {
            const validAlternatives = candidateTools.filter(tool => {
                const scoreEntry = scores.find(s => s.tool === tool);
                return !scoreEntry || scoreEntry.score > -3;
            });
            
            if (validAlternatives.length > 1) {
                const randomTool = validAlternatives[Math.floor(Math.random() * validAlternatives.length)];
                this.logger.info('tool_selection', `[EXPLORATION] confidence=${decisionConfidence.toFixed(2)} rate=${explorationRate} choosing_alternative=${randomTool} for_step=${stepType}`);
                return randomTool;
            }
        }
        
        for (const candidate of candidateTools) {
            const scoreEntry = scores.find(s => s.tool === candidate);
            if (scoreEntry && scoreEntry.score > 0) {
                this.logger.debug('tool_selection', `[LEARNING] Tool ${candidate} selected (score=${scoreEntry.score}) for ${stepType}`);
                return candidate;
            }
        }
        
        const lowestFailing = scores.filter(s => s.score < 0).pop();
        if (lowestFailing) {
            this.logger.debug('tool_selection', `[LEARNING] Avoiding tool ${lowestFailing.tool} (score=${lowestFailing.score}) for ${stepType}`);
        }
        
        return null;
    }

    private logMemoryStats() {
        if (this.executionMemory.length === 0) return;
        
        const stats = new Map<string, { success: number; failure: number }>();
        for (const entry of this.executionMemory) {
            const key = `${entry.stepType}:${entry.tool}`;
            const s = stats.get(key) || { success: 0, failure: 0 };
            if (entry.success) s.success++; else s.failure++;
            stats.set(key, s);
        }
        
        let msg = '[MEMORY STATS]\n';
        stats.forEach((s, key) => {
            const total = s.success + s.failure;
            const rate = total > 0 ? Math.round((s.success / total) * 100) : 0;
            msg += `${key}: ${s.success}✓ ${s.failure}✗ (${rate}%)\n`;
        });
        
        this.logger.debug('memory_stats', msg);
    }
}
