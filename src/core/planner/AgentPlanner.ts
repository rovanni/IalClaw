import ollama from 'ollama';
import { ExecutionPlan, PlannerDiagnostics, PlannerOutput } from './types';
import { validatePlan } from './PlanValidator';
import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { CognitiveMemory, NodeResult } from '../../memory/CognitiveMemory';
import { SessionManager } from '../../shared/SessionManager';
import { ProviderFactory } from '../../engine/ProviderFactory';
import { parseLlmJson, parseLlmJsonWithRecovery } from '../../utils/parseLlmJson';
import { selectTemplate } from './templates/planTemplates';
import { buildWorkspaceContext, formatWorkspaceContext } from './workspaceContext';
import { formatTargetFileBlock, rankFiles, selectWithConfidence } from './fileTargeting';
import { createLogger } from '../../shared/AppLogger';
import { buildPlannerFallbackPlan } from './planningRecovery';
import { computeConfidence, evaluateSessionConsistency } from './plannerDiagnostics';
import { t } from '../../i18n';

export class AgentPlanner {
    private logger = createLogger('AgentPlanner');

    constructor(private memory: CognitiveMemory) { }

    async createPlan(userInput: string): Promise<ExecutionPlan> {
        const output = await this.createPlanWithDiagnostics(userInput);

        if (!output.plan) {
            throw new Error(t('error.planner.plan_not_generated'));
        }

        return output.plan;
    }

    async createPlanWithDiagnostics(userInput: string, options?: {
        supplementalInstruction?: string;
        bypassTemplates?: boolean;
    }): Promise<PlannerOutput> {
        const ctx = getContext();
        const traceId = ctx?.trace_id;
        emitDebug('thought', { type: 'thought', content: '[PLANNER] Consultando o Grafo Cognitivo por projetos e padroes passados...' });

        if (!this.memory || typeof this.memory.retrieveWithTraversal !== 'function') {
            throw new Error(t('error.planner.memory_provider_invalid'));
        }

        const provider = ProviderFactory.getProvider();
        const queryEmbedding = await provider.embed(userInput);
        const memoryNodes = await this.memory.retrieveWithTraversal(userInput, queryEmbedding, 3);
        const memoryContext = this.buildMemoryContext(memoryNodes);
        const session = SessionManager.getCurrentSession();
        const workspaceContext = buildWorkspaceContext(session?.current_project_id);
        const workspacePrompt = formatWorkspaceContext(workspaceContext);
        const rankedFiles = rankFiles({
            goal: userInput,
            error: session?.last_error_type === 'tool_input' && session.last_error ? this.safeParseErrorPayload(session.last_error) : null,
            files: workspaceContext
        });
        const fileSelection = selectWithConfidence(rankedFiles);
        const targetFilePrompt = formatTargetFileBlock(fileSelection);
        const fileTargetConfidence = fileSelection?.confidence ?? 1;
        const sessionConsistency = evaluateSessionConsistency(
            userInput,
            session?.current_goal,
            Boolean(session?.continue_project_only)
        );
        let parseRecovered = false;
        let validationPassed = false;
        let hallucinatedToolDetected = false;

        if (fileSelection) {
            emitDebug('thought', {
                type: 'thought',
                content: `[PLANNER] File targeting: ${fileSelection.target} (conf=${fileSelection.confidence.toFixed(2)}, gap=${fileSelection.top2Gap})`
            });
        }

        const selectedTemplate = options?.bypassTemplates ? null : selectTemplate(userInput);
        if (selectedTemplate) {
            emitDebug('thought', {
                type: 'thought',
                content: `[PLANNER] Template selecionado: ${selectedTemplate.id}`
            });

            const templatePlan = await selectedTemplate.build({
                goal: userInput,
                provider,
                hasActiveProject: Boolean(session?.current_project_id),
                currentProjectId: session?.current_project_id,
                workspaceContext
            });

            validatePlan(templatePlan);
            validationPassed = true;
            emitDebug('thought', {
                type: 'thought',
                content: `[PLANNER] Plano gerado por template: ${templatePlan.goal} (${templatePlan.steps.length} passos).`
            });
            return {
                plan: templatePlan,
                diagnostics: this.buildDiagnostics({
                    parseRecovered,
                    validationPassed,
                    hallucinatedToolDetected,
                    sessionConsistency,
                    fileTargetConfidence
                })
            };
        }

        emitDebug('thought', { type: 'thought', content: '[PLANNER] Elaborando plano de execucao estruturado...' });

        const prompt = this.buildPrompt(userInput, memoryContext, workspacePrompt, targetFilePrompt, options?.supplementalInstruction);

        try {
            const response = await ollama.chat({
                model: process.env.MODEL || 'llama3.2',
                messages: [{ role: 'system', content: prompt }, { role: 'user', content: userInput }],
                format: 'json',
                options: { temperature: 0.1 }
            });

            let plan: ExecutionPlan;

            try {
                const parsed = parseLlmJsonWithRecovery<ExecutionPlan>(response.message.content);
                plan = parsed.value;

                if (parsed.meta.repaired) {
                    parseRecovered = true;
                    emitDebug('thought', {
                        type: 'thought',
                        content: '[PLANNER] JSON recuperado localmente por heuristica antes da validacao.'
                    });

                    this.logger.info('planner_json_recovered', 'Planner retornou JSON recuperavel por heuristica local.', {
                        truncated_likely: parsed.meta.truncatedLikely,
                        removed_trailing_commas: parsed.meta.removedTrailingCommas,
                        balanced_closers: parsed.meta.balancedClosers,
                        closed_open_string: parsed.meta.closedOpenString,
                        pruned_dangling_tail: parsed.meta.prunedDanglingTail
                    });
                }
            } catch (parseError: any) {
                if (!this.isJsonParseFailure(parseError)) {
                    throw parseError;
                }

                emitDebug('thought', {
                    type: 'thought',
                    content: '[PLANNER] JSON invalido ou truncado detectado. Tentando regenerar um plano compacto...'
                });

                this.logger.warn('planner_json_parse_failed', 'Planner retornou JSON invalido; iniciando retry compacto.', {
                    response_length: response.message.content?.length || 0,
                    error_message: parseError.message
                });

                try {
                    plan = await this.repairMalformedPlan(userInput, prompt, response.message.content || '', parseError.message);
                    parseRecovered = true;
                } catch (repairError: any) {
                    return this.buildFallbackOutput(userInput, `planner_parse_failed: ${repairError.message}`, {
                        parseRecovered,
                        validationPassed,
                        hallucinatedToolDetected,
                        sessionConsistency,
                        fileTargetConfidence
                    });
                }
            }

            try {
                validatePlan(plan);
                validationPassed = true;
            } catch (validationError: any) {
                if (this.isInvalidToolError(validationError)) {
                    hallucinatedToolDetected = true;
                    emitDebug('thought', { type: 'thought', content: '[PLANNER] Tool invalida detectada no plano. Tentando reparar com lista estrita de tools...' });
                    try {
                        plan = await this.repairInvalidToolPlan(userInput, prompt, plan, validationError.message);
                        validationPassed = true;
                    } catch (repairError: any) {
                        return this.buildFallbackOutput(userInput, `planner_validation_failed: ${repairError.message}`, {
                            parseRecovered,
                            validationPassed: false,
                            hallucinatedToolDetected,
                            sessionConsistency,
                            fileTargetConfidence
                        });
                    }
                } else {
                    return this.buildFallbackOutput(userInput, `planner_validation_failed: ${validationError.message}`, {
                        parseRecovered,
                        validationPassed: false,
                        hallucinatedToolDetected,
                        sessionConsistency,
                        fileTargetConfidence
                    });
                }
            }

            emitDebug('thought', { type: 'thought', content: `[PLANNER] Plano validado: ${plan.goal} (${plan.steps.length} passos).` });
            return {
                plan,
                diagnostics: this.buildDiagnostics({
                    parseRecovered,
                    validationPassed,
                    hallucinatedToolDetected,
                    sessionConsistency,
                    fileTargetConfidence
                })
            };
        } catch (error: any) {
            emitDebug('agent:error', { trace_id: traceId, error: `Falha no planejamento: ${error.message}` });
            this.logger.error('planner_unexpected_failure', error, 'Falha inesperada durante a criacao do plano.', {
                session_consistency: sessionConsistency,
                file_target_confidence: fileTargetConfidence
            });

            return this.buildFallbackOutput(userInput, `planner_unexpected_failure: ${error.message}`, {
                parseRecovered,
                validationPassed: false,
                hallucinatedToolDetected,
                sessionConsistency,
                fileTargetConfidence
            });
        }
    }

    private buildMemoryContext(nodes: NodeResult[]): string {
        if (!nodes || nodes.length === 0) {
            return 'Nenhuma memoria relevante encontrada. Crie a arquitetura do zero com as melhores praticas.';
        }

        const hints = nodes.map(node => `- Padrao extraido de [${node.name}]: ${node.content_preview || node.content || 'sem preview'}`);
        return `MEMORIA ESTRUTURAL RELEVANTE (Projetos e Conceitos Passados):\n${hints.join('\n')}\n\nRECOMENDACAO: Reutilize essas abordagens e estruturas conhecidas para garantir consistencia.`;
    }

    private buildPrompt(input: string, memoryContext: string, workspacePrompt: string, targetFilePrompt: string, supplementalInstruction?: string): string {
        const registeredTools = toolRegistry.list();
        const tools = registeredTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');
        const toolNames = registeredTools.map(tool => tool.name);
        const strictToolList = toolNames.map(name => `- ${name}`).join('\n');
        const strictToolEnum = toolNames.map(name => `"${name}"`).join(', ');
        const session = SessionManager.getCurrentSession();

        let sessionPrompt = '';
        if (session && (session.current_goal || session.current_project_id)) {
            sessionPrompt = `
CONTEXTO DE SESSAO ATUAL (CONTINUIDADE DE TAREFA):
- Objetivo da Sessao: ${session.current_goal || 'nenhum'}
- ID do Projeto Ativo: ${session.current_project_id || 'nenhum'}
- Continuidade estrita: ${session.continue_project_only ? 'sim' : 'nao'}
- Arquivos ja gerados nesta sessao: ${session.last_artifacts.length > 0 ? session.last_artifacts.join(', ') : 'nenhum'}
- Ultimo erro observado: ${session.last_error || 'nenhum'}

ATENCAO A CONTINUIDADE:
- Se o usuario estiver pedindo algo relacionado a arquivos gerados ou ao objetivo atual, nao reinicie nem mude de dominio.
- Continue a tarefa do projeto existente chamando "workspace_save_artifact".
- O campo "project_id" pode ser omitido que o sistema injetara automaticamente o projeto correspondente a sessao.
- Se houver ultimo erro, foque em corrigir o erro sem recriar o projeto.
- Se "Continuidade estrita" for "sim", nunca tente criar um novo projeto.
`;

            if (session.last_error_type === 'tool_input' && session.last_error) {
                try {
                    const payload = JSON.parse(session.last_error);
                    const issues = Array.isArray(payload.issues)
                        ? payload.issues.map((issue: any) => `- ${issue.path || ''}: ${issue.message} (expected: ${issue.expected ?? 'unknown'}, received: ${issue.received ?? 'unknown'})`).join('\n')
                        : '- sem issues estruturadas';

                    sessionPrompt += `
PREVIOUS ERROR (JSON):
${session.last_error}

If type == "tool_input":
- Tool: ${payload.tool || 'unknown'}
- Issues:
${issues}

INSTRUCTION:
- Fix ONLY the invalid input fields reported in "issues".
- Do NOT change other steps or recreate the project.
- Keep all valid fields unchanged.
- Ensure all required fields are present and correctly typed.
- Return ONLY the corrected "input" object for the SAME tool.
- Do NOT change tool name.
- Do NOT modify other steps.
`;
                } catch {
                    sessionPrompt += `
PREVIOUS ERROR (JSON):
${session.last_error}
`;
                }
            }
        }

        return `Voce e o IalClaw Planner, um arquiteto cognitivo deterministico com memoria.
Sua missao e converter o pedido do usuario em um JSON estrito contendo o plano de execucao passo a passo.

FERRAMENTAS DISPONIVEIS:
${tools}

AVAILABLE TOOLS (STRICT):
You MUST use ONLY these tools:
${strictToolList}
Do NOT invent tools.
Do NOT use unknown tools.

${memoryContext}
${workspacePrompt}
${targetFilePrompt}
${sessionPrompt}

REGRAS DE OURO:
1. Retorne APENAS um JSON valido. Nenhuma palavra a mais.
2. Nao invente ferramentas.
3. Se for um novo projeto para gerar arquivos, o passo 1 DEVE ser "workspace_create_project". Se for continuacao, nao crie de novo.
4. OMITA o campo "project_id" nas chamadas "workspace_save_artifact", o sistema injeta em runtime.
5. Forneca o codigo funcional completo no campo "content" ao salvar artefatos.
6. CRITICAL: Return ONLY valid JSON. Do NOT use markdown. Do NOT wrap in code fences.
7. When calling "workspace_create_project", ALWAYS include "name", "type" and "prompt" as strings.

FORMATO JSON ESPERADO:
{
  "goal": "Resumo",
  "steps": [
    {
      "id": 1,
      "type": "tool",
      "tool": "name",
      "input": { },
      "capabilities": { "requiresDOM": false }
    }
  ]
}

RESTRICAO DE SCHEMA:
- Cada step.tool DEVE ser um destes valores: [${strictToolEnum}]
- Use "capabilities.requiresDOM": true SOMENTE quando a tarefa depender explicitamente de execucao real em browser/DOM.
- Para gerar ou editar HTML/CSS/JS, criar frontend, criar jogo da cobrinha ou adicionar audio via Web Audio API, use "requiresDOM": false ou omita o campo.
- Para validar animacao real, medir console no navegador ou testar interacao DOM, use "requiresDOM": true.
${supplementalInstruction ? `\nINSTRUCAO ADICIONAL:\n${supplementalInstruction}` : ''}`;
    }

    private safeParseErrorPayload(raw?: string): any | null {
        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    private isInvalidToolError(error: any): boolean {
        const message = String(error?.message || '');
        return message.includes('tool alucinada detectada no plano');
    }

    private isJsonParseFailure(error: any): boolean {
        return String(error?.message || '').includes('Failed to parse LLM JSON');
    }

    private async repairInvalidToolPlan(userInput: string, basePrompt: string, invalidPlan: ExecutionPlan, validationMessage: string): Promise<ExecutionPlan> {
        const response = await ollama.chat({
            model: process.env.MODEL || 'llama3.2',
            messages: [
                { role: 'system', content: basePrompt },
                {
                    role: 'user',
                    content: `O plano anterior usou uma tool invalida.

ERRO:
${validationMessage}

PLANO INVALIDO:
${JSON.stringify(invalidPlan, null, 2)}

TAREFA ORIGINAL:
${userInput}

INSTRUCAO:
- Use ONLY allowed tools.
- Corrija o plano.
- Retorne apenas JSON valido.`
                }
            ],
            format: 'json',
            options: { temperature: 0.1 }
        });

        const repairedPlan = parseLlmJson<ExecutionPlan>(response.message.content);
        validatePlan(repairedPlan);
        return repairedPlan;
    }

    private async repairMalformedPlan(userInput: string, basePrompt: string, rawResponse: string, parseErrorMessage: string): Promise<ExecutionPlan> {
        const response = await ollama.chat({
            model: process.env.MODEL || 'llama3.2',
            messages: [
                { role: 'system', content: basePrompt },
                {
                    role: 'user',
                    content: `A resposta anterior nao era um JSON valido.

ERRO:
${parseErrorMessage}

RESPOSTA INVALIDA/PARCIAL:
${rawResponse.slice(0, 2000)}

TAREFA ORIGINAL:
${userInput}

INSTRUCAO:
- Retorne um JSON VALIDO e COMPACTO.
- Use no maximo 4 steps.
- Use strings curtas e objetivas nos campos textuais.
- Se usar workspace_create_project, use "prompt" igual a tarefa original sem expandir desnecessariamente.
- Nao inclua markdown.
- Nao inclua explicacoes.
- Retorne apenas JSON.`
                }
            ],
            format: 'json',
            options: { temperature: 0 }
        });

        const repairedPlan = parseLlmJson<ExecutionPlan>(response.message.content);
        validatePlan(repairedPlan);
        return repairedPlan;
    }

    private buildFallbackPlan(userInput: string, reason: string): ExecutionPlan {
        const session = SessionManager.getCurrentSession();
        const fallbackPlan = buildPlannerFallbackPlan(userInput, Boolean(session?.current_project_id), reason);

        emitDebug('thought', {
            type: 'thought',
            content: '[PLANNER] Ativando fallback resiliente apos falha de parse/validacao.'
        });

        this.logger.warn('planner_fallback_plan_activated', 'Planner entrou em modo fallback resiliente.', {
            reason,
            goal: fallbackPlan.goal,
            steps: fallbackPlan.steps.map(step => ({
                id: step.id,
                tool: step.tool
            }))
        });

        validatePlan(fallbackPlan);
        return fallbackPlan;
    }

    private buildFallbackOutput(
        userInput: string,
        reason: string,
        baseDiagnostics: Omit<PlannerDiagnostics, 'confidenceScore'>
    ): PlannerOutput {
        const fallbackPlan = this.buildFallbackPlan(userInput, reason);

        return {
            plan: fallbackPlan,
            diagnostics: this.buildDiagnostics({
                ...baseDiagnostics,
                validationPassed: false
            })
        };
    }

    private buildDiagnostics(base: Omit<PlannerDiagnostics, 'confidenceScore'>): PlannerDiagnostics {
        return {
            ...base,
            confidenceScore: computeConfidence(base)
        };
    }
}
