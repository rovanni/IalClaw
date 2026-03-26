import { LLMProvider, MessagePayload } from './ProviderFactory';
import { SkillRegistry } from './SkillRegistry';
import { createLogger } from '../shared/AppLogger';
import { emitDebug } from '../shared/DebugBus';

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
    private maxIterations = 5;
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
        const maxTools = policy?.limits?.max_tool_calls || 5;
        let toolCallsCount = 0;
        const toolEvidence: string[] = [];
        const startedAt = Date.now();

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

        this.logger.info('loop_started', 'AgentLoop iniciado.', {
            initial_messages: initialMessages.length,
            max_iterations: maxIter,
            max_tools: maxTools,
            available_tools: toolsDefinition.length
        });

        for (let i = 0; i < maxIter; i++) {
            this.logger.debug('iteration_started', 'Nova iteracao do AgentLoop.', {
                iteration: i + 1,
                message_count: messages.length,
                tool_calls_count: toolCallsCount
            });
            const response = await this.llm.generate(messages, toolsDefinition);

            if (response.tool_call) {
                if (toolCallsCount >= maxTools) {
                    const blockMsg: MessagePayload = { role: 'tool', content: `[POLICY ENGINE] Tool call limite reached. Max: ${maxTools}` };
                    const assistBlock: MessagePayload = { role: 'assistant', content: `[Tentei executar ${response.tool_call.name} mas fui bloqueado pela Policy de limites]` };
                    messages.push(assistBlock, blockMsg);
                    newMessages.push(assistBlock, blockMsg);
                    this.logger.warn('tool_call_blocked', 'Tool call bloqueada pela policy de limite.', {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        max_tools: maxTools
                    });
                    continue; // Pushes model to finalize answer
                }

                toolCallsCount++;
                try {
                    this.logger.info('tool_call_started', 'Executando tool chamada pelo modelo.', {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        tool_calls_count: toolCallsCount
                    });
                    const result = await this.registry.executeTool(response.tool_call.name, response.tool_call.args);
                    toolEvidence.push(String(result).slice(0, 2000));

                    const assistantMsg: MessagePayload = {
                        role: 'assistant',
                        content: '',
                        tool_name: response.tool_call.name,
                        tool_args: response.tool_call.args
                    };
                    const toolMsg: MessagePayload = { role: 'tool', content: result };

                    messages.push(assistantMsg, toolMsg);
                    newMessages.push(assistantMsg, toolMsg);

                    this.logger.info('tool_call_completed', 'Tool executada com sucesso.', {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        result_length: result.length
                    });

                    continue;
                } catch (error: any) {
                    this.logger.error('tool_call_failed', error, 'Falha ao executar tool.', {
                        iteration: i + 1,
                        tool_name: response.tool_call.name
                    });
                    const errMsg: MessagePayload = { role: 'tool', content: `Erro ao executar tool: ${error.message}` };
                    messages.push(errMsg);
                    newMessages.push(errMsg);
                    continue;
                }
            }

            if (response.final_answer) {
                const sanitizedAnswer = this.sanitizeUserFacingAnswer(response.final_answer);
                const safeAnswer = this.applyExecutionClaimGuard(sanitizedAnswer, toolCallsCount, toolEvidence);
                const finalMsg: MessagePayload = { role: 'assistant', content: safeAnswer };
                messages.push(finalMsg);
                newMessages.push(finalMsg);
                this.logger.info('loop_completed', 'AgentLoop finalizado com resposta final.', {
                    duration_ms: Date.now() - startedAt,
                    iterations_used: i + 1,
                    tool_calls_count: toolCallsCount,
                    answer_length: safeAnswer.length
                });
                return { answer: safeAnswer, newMessages };
            }
        }

        this.logger.error('loop_max_iterations_reached', new Error('Max iterations reached in AgentLoop.'), 'AgentLoop excedeu o limite de iteracoes.', {
            duration_ms: Date.now() - startedAt,
            max_iterations: maxIter,
            tool_calls_count: toolCallsCount
        });
        throw new Error("Max iterations reached in AgentLoop.");
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
        const suffix = '\n\nNota: nao executei esses comandos aqui. Se quiser, eu te passo os passos para rodar localmente.';
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
            return 'Consegui processar sua solicitacao e posso continuar com o proximo passo.';
        }

        return cleaned;
    }
}
