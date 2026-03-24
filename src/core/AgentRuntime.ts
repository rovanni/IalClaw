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
                    if (result.error_type === 'missing_capability' && result.capability === 'browser_execution') {
                        return result.error || `O ambiente atual nao oferece a capacidade obrigatoria: ${result.capability}.`;
                    }

                    if (result.error_type === 'environment_dependency' && result.dependency === 'puppeteer') {
                        return `O projeto foi gerado, mas falta um componente do ambiente para testar HTML automaticamente: puppeteer.

Voce pode seguir de duas formas:
1. instalar o componente manualmente
2. autorizar o agente a tentar instalar para voce

Se quiser, me responda:
"pode instalar o puppeteer"
e eu tento fazer isso para voce.`;
                    }

                    return `Falha na execucao do plano: ${result.error}`;
                }

                return `Plano executado com sucesso.
Meta: ${plan.goal}
Passos executados: ${plan.steps.length}
Os traces completos ficam no Thought Trace e no Interaction Panel deste dashboard.`;
            } catch (error: any) {
                return `Falha na execucao do plano: ${error.message}`;
            }
        }, 'runtime_core');
    }
}
