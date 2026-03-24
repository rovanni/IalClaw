import { executeToolCall } from '../../dashboard/public/executeTool';
import { ExecutionPlan } from '../planner/types';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';

export class AgentExecutor {
    async run(plan: ExecutionPlan) {
        const ctx = getContext();
        emitDebug('thought', { type: 'action', content: `[EXECUTOR] Iniciando meta: ${plan.goal}` });

        for (const step of plan.steps) {
            emitDebug('thought', { type: 'thought', content: `[EXECUTOR] Executando Step ${step.id}: ${step.tool}` });

            // Reutilizamos toda a segurança (FileSystem, Traces e Auto-Heal) que fizemos no executeToolCall
            const result = await executeToolCall(step.tool, step.input);

            if (!result.success) {
                emitDebug('thought', { type: 'error', content: `[EXECUTOR] Abortando! Falha no Step ${step.id}: ${result.error}` });
                throw new Error(`Execução interrompida no step ${step.id}: ${result.error}`);
            }
            
            // Um respiro para a UI processar (Opcional, mas bonito para o Dashboard)
            await new Promise(res => setTimeout(res, 500));
        }

        emitDebug('thought', { type: 'final', content: '[EXECUTOR] Plano finalizado com sucesso!' });
    }
}