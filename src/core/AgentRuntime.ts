import { AgentPlanner } from './planner/AgentPlanner';
import { AgentExecutor } from './executor/AgentExecutor';
import { emitDebug } from '../shared/DebugBus';
import { runWithTrace } from '../shared/TraceContext';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { SessionManager } from '../shared/SessionManager';

export class AgentRuntime {
    private planner: AgentPlanner;
    private executor: AgentExecutor;

    constructor(memory: CognitiveMemory) {
        this.planner = new AgentPlanner(memory);
        this.executor = new AgentExecutor(memory);
    }

    async execute(userInput: string, mode: 'react' | 'planner' = 'planner'): Promise<string> {
        return runWithTrace(async () => {
            emitDebug('gateway', { route: mode, query: userInput, timestamp: Date.now() });

            if (mode !== 'planner') {
                return 'Fluxo ReAct legado acionado (adicione a logica do AgentLoop aqui, se necessario).';
            }

            try {
                const plan = await this.planner.createPlan(userInput);
                emitDebug('plan_generated', { plan });
                const session = SessionManager.getCurrentSession();

                if (!session) {
                    throw new Error('Sessao ativa nao encontrada para executar o plano.');
                }

                const result = await this.executor.runWithHealing(plan, session);

                if (!result.success) {
                    return `Falha na execucao do plano: ${result.error}`;
                }

                return `Plano executado com sucesso.
Meta: ${plan.goal}
Passos executados: ${plan.steps.length}
Verifique o Dashboard Web para os traces completos.`;
            } catch (error: any) {
                return `Falha na execucao do plano: ${error.message}`;
            }
        }, 'runtime_core');
    }
}
