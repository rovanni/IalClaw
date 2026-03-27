import { LLMProvider, MessagePayload } from './ProviderFactory';
import { SkillRegistry } from './SkillRegistry';
import { createLogger } from '../shared/AppLogger';
import { emitDebug } from '../shared/DebugBus';
import { t } from '../i18n';

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
    | 'failed';
    iteration?: number;
    tool_name?: string;
    duration_ms?: number;
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

export class AgentLoop {
    private llm: LLMProvider;
    private registry: SkillRegistry;
    private maxIterations = 4;
    private logger = createLogger('AgentLoop');

    constructor(llm: LLMProvider, registry: SkillRegistry) {
        this.llm = llm;
        this.registry = registry;
    }

    public getProvider(): LLMProvider {
        return this.llm;
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

        const messages = [...initialMessages];
        const newMessages: MessagePayload[] = [];
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
            await emitProgress({ stage: 'llm_started', iteration: i + 1 });
            const response = await this.llm.generate(messages, toolsDefinition);
            await emitProgress({ stage: 'llm_completed', iteration: i + 1 });

            if (await stopIfRequested()) {
                return { answer: t('loop.stopped_by_user'), newMessages };
            }

            if (response.tool_call) {
                // Detectar loop de ferramenta repetida
                if (lastToolName === response.tool_call.name) {
                    toolRepeatCount++;
                    if (toolRepeatCount >= 2) {
                        this.logger.warn('tool_loop_detected', t('log.loop.tool_loop_detected'), {
                            tool_name: response.tool_call.name,
                            repeat_count: toolRepeatCount
                        });
                        const loopMsg: MessagePayload = {
                            role: 'system',
                            content: t('loop.system.repeated_tool', { tool: response.tool_call.name })
                        };
                        messages.push(loopMsg);
                        continue;
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
                    this.logger.info('tool_call_started', t('log.loop.tool_call_started'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        tool_calls_count: toolCallsCount
                    });
                    await emitProgress({ stage: 'tool_started', iteration: i + 1, tool_name: response.tool_call.name });
                    const result = await this.registry.executeTool(response.tool_call.name, response.tool_call.args);
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
                    const errMsg: MessagePayload = { role: 'tool', content: t('loop.tool_execution_error', { message: error.message }) };
                    messages.push(errMsg);
                    newMessages.push(errMsg);
                    consecutiveToolFailures++;

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
            return { answer: sanitized, newMessages };
        } catch (fallbackError: any) {
            this.logger.error('loop_fallback_failed', fallbackError, t('log.loop.fallback_failed'), {
                duration_ms: Date.now() - startedAt
            });
            await emitProgress({ stage: 'failed' });
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
}
