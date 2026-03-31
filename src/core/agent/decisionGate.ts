// ── Decision Gate ──────────────────────────────────────────────────────────
// Recebe intent + contexto de sessão e decide: execute | confirm | pass.
// O controller não precisa conhecer as regras — só reage ao Decision.

import { IntentionResolver } from './IntentionResolver';
import { SessionContext } from '../../shared/SessionManager';
import { classifyTask, TaskType } from './TaskClassifier';

export type Decision =
    | { type: 'execute'; message: string }
    | { type: 'confirm'; message: string }
    | { type: 'pass'; taskType?: TaskType; taskConfidence?: number };

export interface DecisionGateInput {
    text: string;
    session?: SessionContext;
}

// Thresholds de confiança
const THRESHOLD_EXECUTE = 0.75;
const THRESHOLD_CONFIRM = 0.4;

/**
 * Avalia a entrada e retorna a decisão que o controller deve seguir.
 */
export function decisionGate(input: DecisionGateInput): Decision {
    const match = IntentionResolver.resolve(input.text);
    const intentType = match.type.toLowerCase();
    const confidenceVal = match.confidence;

    const taskClassification = classifyTask(input.text);
    const { session } = input;

    if (session) {
        (session as any).task_type = taskClassification.type;
        (session as any).task_confidence = taskClassification.confidence;
    }

    if (intentType === 'unknown') return { type: 'pass', taskType: taskClassification.type, taskConfidence: taskClassification.confidence };

    // Boost de contexto: projeto ativo adiciona confiança
    let confidence = confidenceVal;
    if (session?.current_project_id) confidence += 0.2;

    // Penalidade: entrada muito curta sem verbo claro — já coberta pelo detector,
    // mas mensagens de 1-2 chars sem match forte ficam em 'pass' naturalmente.

    const taskInfo = { taskType: taskClassification.type, taskConfidence: taskClassification.confidence };

    // ── Continue intent ──────────────────────────────────────────────────
    if (intentType === 'continue') {
        if (!session?.current_project_id) return { type: 'pass', ...taskInfo };

        // Já em modo continuação + confiança alta → auto-resolve
        if (confidence >= THRESHOLD_EXECUTE && session.continue_project_only) {
            return {
                type: 'execute',
                message: `Vou continuar o projeto atual (${session.current_project_id}) — se nao era isso, me avisa.`
            };
        }

        if (confidence >= THRESHOLD_EXECUTE) {
            return {
                type: 'execute',
                message: `Vou continuar apenas o projeto atual desta sessao (${session.current_project_id}) e nao vou criar um projeto novo.`
            };
        }

        if (confidence >= THRESHOLD_CONFIRM) {
            return {
                type: 'confirm',
                message: `Voce quer que eu continue o projeto "${session.current_project_id}" ou esta se referindo a outra coisa?`
            };
        }

        return { type: 'pass', ...taskInfo };
    }

    // ── Stop / Cancel intent ─────────────────────────────────────────────
    // Passamos para o pipeline principal tratar (pode envolver cleanup de sessão)
    if (intentType === 'stop') {
        return { type: 'pass', ...taskInfo };
    }

    // ── Execute intent ───────────────────────────────────────────────────
    // "roda", "executa" etc. — passa para o pipeline normal processar
    if (intentType === 'execute' || intentType === 'task') {
        return { type: 'pass', ...taskInfo };
    }

    return { type: 'pass', ...taskInfo };
}
