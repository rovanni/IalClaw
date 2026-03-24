import { AgentPlanner } from '../../dashboard/public/AgentPlanner';
import { AgentExecutor } from '../../dashboard/public/AgentExecutor';
import { emitDebug } from '../../shared/DebugBus';
import { runWithTrace } from '../../shared/TraceContext';
import { CognitiveMemory } from '../../../../specs/lib/CognitiveMemory'; // Ajuste o path da sua lib

export class AgentRuntime {
    private planner: AgentPlanner;
    private executor: AgentExecutor;

    constructor(memory: CognitiveMemory) {
        this.planner = new AgentPlanner(memory);
        this.executor = new AgentExecutor();
    }

    /**
     * Executa a requisição do usuário com Rastreamento Injetado automaticamente.
     */
    async execute(userInput: string, mode: 'react' | 'planner' = 'planner'): Promise<string> {
        return runWithTrace(async () => {
            emitDebug('gateway', { route: mode, query: userInput, timestamp: Date.now() });

            if (mode === 'planner') {
                try {
                    // 1. Planeja com base na Memória Cognitiva
                    const plan = await this.planner.createPlan(userInput);
                    
                    // 2. Executa Cegamente
                    await this.executor.run(plan);
                    return `✅ Plano executado com sucesso!\nMeta: ${plan.goal}\nPassos executados: ${plan.steps.length}\nVerifique o Dashboard Web para os Traces completos.`;
                } catch (error: any) {
                    return `❌ Falha na execução do plano: ${error.message}`;
                }
            } else {
                return "Fluxo ReAct legado acionado (Adicione a lógica do AgentLoop original aqui).";
            }
        }, 'runtime_core');
    }
}