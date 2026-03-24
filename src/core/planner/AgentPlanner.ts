import ollama from 'ollama';
import { ExecutionPlan } from './types';
import { validatePlan } from './PlanValidator';
import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { SessionManager } from '../../shared/SessionManager';

export class AgentPlanner {
    constructor(private memory: CognitiveMemory) { }

    async createPlan(userInput: string): Promise<ExecutionPlan> {
        const ctx = getContext();
        emitDebug('thought', { type: 'thought', content: '[PLANNER] Consultando o Grafo Cognitivo por projetos e padrões passados...' });

        // Fazemos o cast para 'any' para evitar erro caso o método .search() não esteja declarado na tipagem da sua classe
        const searchResult = (this.memory as any).search(userInput, 3);
        const memoryContext = this.buildMemoryContext(searchResult.nodes);

        emitDebug('thought', { type: 'thought', content: '[PLANNER] Elaborando plano de execução estruturado...' });

        const prompt = this.buildPrompt(userInput, memoryContext);

        try {
            const response = await ollama.chat({
                model: process.env.MODEL || 'llama3.2',
                messages: [{ role: 'system', content: prompt }, { role: 'user', content: userInput }],
                format: 'json', // 🔥 Força saída em JSON estrito
                options: { temperature: 0.1 } // Alto determinismo, menos criatividade fora da caixa
            });

            const plan: ExecutionPlan = JSON.parse(response.message.content);
            validatePlan(plan); // Tenta quebrar rápido se for inválido

            emitDebug('thought', { type: 'thought', content: `[PLANNER] Plano validado: ${plan.goal} (${plan.steps.length} passos).` });
            return plan;
        } catch (error: any) {
            emitDebug('agent:error', { trace_id: ctx.trace_id, error: `Falha no planejamento: ${error.message}` });
            throw error;
        }
    }

    private buildMemoryContext(nodes: any[]): string {
        if (!nodes || nodes.length === 0) {
            return "Nenhuma memória relevante encontrada. Crie a arquitetura do zero com as melhores práticas.";
        }

        const hints = nodes.map(n => `- Padrão extraído de [${n.name}]: ${n.content_preview}`);
        return `MEMÓRIA ESTRUTURAL RELEVANTE (Projetos e Conceitos Passados):\n${hints.join('\n')}\n\nRECOMENDAÇÃO: Reutilize essas abordagens/estruturas conhecidas para garantir consistência.`;
    }

    private buildPrompt(input: string, memoryContext: string): string {
        const tools = toolRegistry.list().map((t: any) => `- ${t.name}: ${t.description}`).join('\n');

        const session = SessionManager.getCurrentSession();
        let sessionPrompt = '';
        if (session && (session.current_goal || session.current_project_id)) {
            sessionPrompt = `
CONTEXTO DE SESSÃO ATUAL (CONTINUIDADE DE TAREFA):
- Objetivo da Sessão: ${session.current_goal || "nenhum"}
- ID do Projeto Ativo: ${session.current_project_id || "nenhum"}
- Arquivos já gerados nesta sessão: ${session.last_artifacts.length > 0 ? session.last_artifacts.join(", ") : "nenhum"}

ATENÇÃO À CONTINUIDADE:
- Se o usuário estiver pedindo algo relacionado a arquivos gerados ou ao objetivo atual, NÃO reinicie nem mude de domínio.
- Continue a tarefa do projeto existente chamando "workspace_save_artifact".
- O campo "project_id" pode ser omitido que o sistema injetará automaticamente o projeto correspondente à sessão.
`;
        }

        return `Você é o IalClaw Planner, um Arquiteto Cognitivo determinístico com memória.
Sua missão é converter o pedido do usuário em um JSON estrito contendo o plano de execução passo a passo.

FERRAMENTAS DISPONÍVEIS:
${tools}

${memoryContext}
${sessionPrompt}

REGRAS DE OURO:
1. Retorne APENAS um JSON válido. Nenhuma palavra a mais.
2. Não invente ferramentas.
3. Se for um *novo* projeto para gerar arquivos, o passo 1 DEVE ser "workspace_create_project". Se for continuação, não crie de novo.
4. OMITA o campo "project_id" nas chamadas "workspace_save_artifact", o sistema injeta em runtime.
5. Forneça o código funcional completo no campo "content" ao salvar artefatos.

FORMATO JSON ESPERADO:\n{\n  "goal": "Resumo",\n  "steps": [\n    { "id": 1, "type": "tool", "tool": "name", "input": { } }\n  ]\n}`;
    }
}