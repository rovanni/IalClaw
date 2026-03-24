import ollama from 'ollama';
import { ExecutionPlan } from './types';
import { validatePlan } from './PlanValidator';
import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { CognitiveMemory, NodeResult } from '../../memory/CognitiveMemory';
import { SessionManager } from '../../shared/SessionManager';
import { ProviderFactory } from '../../engine/ProviderFactory';
import { parseLlmJson } from '../../utils/parseLlmJson';
import { selectTemplate } from './templates/planTemplates';

export class AgentPlanner {
    constructor(private memory: CognitiveMemory) { }

    async createPlan(userInput: string): Promise<ExecutionPlan> {
        const ctx = getContext();
        emitDebug('thought', { type: 'thought', content: '[PLANNER] Consultando o Grafo Cognitivo por projetos e padroes passados...' });

        if (!this.memory || typeof this.memory.retrieveWithTraversal !== 'function') {
            throw new Error('MemoryProvider not configured correctly');
        }

        const provider = ProviderFactory.getProvider();
        const queryEmbedding = await provider.embed(userInput);
        const memoryNodes = await this.memory.retrieveWithTraversal(userInput, queryEmbedding, 3);
        const memoryContext = this.buildMemoryContext(memoryNodes);
        const session = SessionManager.getCurrentSession();

        const selectedTemplate = selectTemplate(userInput);
        if (selectedTemplate) {
            emitDebug('thought', {
                type: 'thought',
                content: `[PLANNER] Template selecionado: ${selectedTemplate.id}`
            });

            const templatePlan = await selectedTemplate.build({
                goal: userInput,
                provider,
                hasActiveProject: Boolean(session?.current_project_id)
            });

            validatePlan(templatePlan);
            emitDebug('thought', {
                type: 'thought',
                content: `[PLANNER] Plano gerado por template: ${templatePlan.goal} (${templatePlan.steps.length} passos).`
            });
            return templatePlan;
        }

        emitDebug('thought', { type: 'thought', content: '[PLANNER] Elaborando plano de execucao estruturado...' });

        const prompt = this.buildPrompt(userInput, memoryContext);

        try {
            const response = await ollama.chat({
                model: process.env.MODEL || 'llama3.2',
                messages: [{ role: 'system', content: prompt }, { role: 'user', content: userInput }],
                format: 'json',
                options: { temperature: 0.1 }
            });

            let plan = parseLlmJson<ExecutionPlan>(response.message.content);

            try {
                validatePlan(plan);
            } catch (validationError: any) {
                if (this.isInvalidToolError(validationError)) {
                    emitDebug('thought', { type: 'thought', content: '[PLANNER] Tool invalida detectada no plano. Tentando reparar com lista estrita de tools...' });
                    plan = await this.repairInvalidToolPlan(userInput, prompt, plan, validationError.message);
                } else {
                    throw validationError;
                }
            }

            emitDebug('thought', { type: 'thought', content: `[PLANNER] Plano validado: ${plan.goal} (${plan.steps.length} passos).` });
            return plan;
        } catch (error: any) {
            emitDebug('agent:error', { trace_id: ctx.trace_id, error: `Falha no planejamento: ${error.message}` });
            throw error;
        }
    }

    private buildMemoryContext(nodes: NodeResult[]): string {
        if (!nodes || nodes.length === 0) {
            return 'Nenhuma memoria relevante encontrada. Crie a arquitetura do zero com as melhores praticas.';
        }

        const hints = nodes.map(node => `- Padrao extraido de [${node.name}]: ${node.content_preview || node.content || 'sem preview'}`);
        return `MEMORIA ESTRUTURAL RELEVANTE (Projetos e Conceitos Passados):\n${hints.join('\n')}\n\nRECOMENDACAO: Reutilize essas abordagens e estruturas conhecidas para garantir consistencia.`;
    }

    private buildPrompt(input: string, memoryContext: string): string {
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
- Arquivos ja gerados nesta sessao: ${session.last_artifacts.length > 0 ? session.last_artifacts.join(', ') : 'nenhum'}
- Ultimo erro observado: ${session.last_error || 'nenhum'}

ATENCAO A CONTINUIDADE:
- Se o usuario estiver pedindo algo relacionado a arquivos gerados ou ao objetivo atual, nao reinicie nem mude de dominio.
- Continue a tarefa do projeto existente chamando "workspace_save_artifact".
- O campo "project_id" pode ser omitido que o sistema injetara automaticamente o projeto correspondente a sessao.
- Se houver ultimo erro, foque em corrigir o erro sem recriar o projeto.
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
    { "id": 1, "type": "tool", "tool": "name", "input": { } }
  ]
}

RESTRICAO DE SCHEMA:
- Cada step.tool DEVE ser um destes valores: [${strictToolEnum}]`;
    }

    private isInvalidToolError(error: any): boolean {
        const message = String(error?.message || '');
        return message.includes('tool alucinada detectada no plano');
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
}
