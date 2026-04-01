import { TaskType } from '../agent/TaskClassifier';
import { TaskContextData } from '../../shared/SessionManager';

export interface AskResult {
    type: 'ask';
    key: string;
    params?: Record<string, string>;
    message: string;
}

export class TaskContextSignals {
    /**
     * Heurística pura para avaliar sinais de continuação.
     * NÃO muda estado. Apenas analisa input vs cognitiveState.
     */
    static detectContinuation(input: string, taskContext?: TaskContextData, lastCompletedAgeMs?: number): boolean {
        // Se há evidência forte de uma ação que acabou de ser concluída (menos de 30s atrás)
        if (lastCompletedAgeMs !== undefined && lastCompletedAgeMs < 30000) {
            return true;
        }

        // Se não há tarefa no estado cognitivo
        if (!taskContext || taskContext.type === 'unknown') {
            return false;
        }

        const now = Date.now();
        const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutos

        const timeSinceLast = now - taskContext.lastUpdated;
        if (timeSinceLast > INACTIVITY_TIMEOUT_MS) {
            return false;
        }

        const text = input.toLowerCase().trim();

        // Mensagem curta = provável follow-up
        const isShortMessage = text.length < 80;

        // Referências à tarefa atual
        const taskReferencePattern = /\b(slide|slides|aula|arquivo|conteúdo|html|esse|isso|ele|ela|ok|certo|sim|não|pronto|agora|resultado|teste|testar|melhorar|ajustar|finalizar|continua|continuar)\b/i;
        const hasTaskReference = taskReferencePattern.test(text);

        // Termos que indicam fortemente acompanhamento do comando anterior
        const continuationHints = [
            '?', 'deu certo', 'funcionou', 'e agora', 'próximo'
        ];
        const hasHint = continuationHints.some(h => text.includes(h));

        // Para ser considerado continuação, precisamos de uma tarefa ativa ou
        // pelo menos uma heurística de relevância forte
        if (taskContext.active) {
            return isShortMessage || hasTaskReference || hasHint;
        }

        // Mesmo não ativa, se a mensagem for muito dependente do contexto anterior, continua
        return (isShortMessage && hasHint) || hasTaskReference;
    }

    /**
     * Verifica estatisticamente se o classificador precisa perguntar sobre fonte.
     * O Orchestrator decide como/quando chamar isso baseado na autonomia.
     */
    static checkNeedsSource(taskType: TaskType, hasSource: boolean): boolean {
        if (hasSource) return false;

        const needsSourceTypes: TaskType[] = ['content_generation', 'file_conversion'];
        return needsSourceTypes.includes(taskType);
    }

    /**
     * Extrai termos de fonte/objetivo puramente do input.
     */
    static extractTaskData(input: string): { source?: string, goal?: string } {
        const data: { source?: string, goal?: string } = {};

        const sourceMatch = input.match(/(\/[^\s,]+)/);
        if (sourceMatch) {
            data.source = sourceMatch[1];
        }

        const goalMatch = input.match(/(?:para|com|usando)\s+(.+)/i);
        if (goalMatch) {
            data.goal = goalMatch[1];
        }

        return data;
    }
}
