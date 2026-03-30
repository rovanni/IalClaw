import { ActionRouter, ExecutionRoute } from '../autonomy/ActionRouter';
import { decideAutonomy, AutonomyDecision, AutonomyLevel } from '../autonomy/DecisionEngine';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';

export enum CognitiveStrategy {
    FLOW = "flow",
    TOOL = "tool",
    LLM = "llm",
    ASK = "ask",
    CONFIRM = "confirm"
}

export interface CognitiveInput {
    input: string;
    taskType?: TaskType | null;
    context?: {
        sessionId?: string;
        projectId?: string;
        autonomyLevel?: AutonomyLevel;
    };
}

export interface CognitiveDecision {
    strategy: CognitiveStrategy;
    confidence: number;
    reason: string;

    route?: any;       // ActionRouter result
    autonomy?: any;    // DecisionEngine result
    memoryHits?: any[]; // memória relevante
}

/**
 * CognitiveOrchestrator: Centraliza a tomada de decisão do agente.
 * Coordena entre fluxos guiados, execução de ferramentas e resposta direta via LLM.
 */
export class CognitiveOrchestrator {
    private logger = createLogger('CognitiveOrchestrator');

    constructor(
        private actionRouter: ActionRouter,
        private memoryService: CognitiveMemory,
        private flowManager: FlowManager
    ) { }

    /**
     * Decide a melhor estratégia para processar o input do usuário.
     */
    async decide(input: CognitiveInput): Promise<CognitiveDecision> {
        const { input: text, taskType, context } = input;

        // 1. Estado atual do Flow (Prioridade máxima de continuidade)
        const flowActive = this.flowManager?.isInFlow();

        // 2. Memória (Pesquisa rápida para contexto na decisão)
        const memoryHits = await this.safeMemoryQuery(text);

        // 3. Roteamento de Intenção (Determina se exige ação no mundo real)
        const routeDecision = this.actionRouter.decideRoute(text, taskType || null);

        // 4. Contexto de Autonomia (Baseado no risco e confiança)
        const autonomyCtx = {
            intent: taskType || "unknown",
            isContinuation: false, // Pode ser refinado futuramente
            hasAllParams: true,    // Assumimos true para a decisão de orquestração básica
            riskLevel: this.detectRisk(text),
            isDestructive: this.isDestructive(text),
            isReversible: true,    // Placeholder
            confidence: routeDecision.confidence,
            intentSubtype: routeDecision.subtype,
            autonomyLevel: context?.autonomyLevel
        };

        const autonomyDecision = decideAutonomy(autonomyCtx);

        this.logger.info('orchestration_decision_process', '[ORCHESTRATOR] Avaliando estratégia...', {
            flowActive,
            route: routeDecision.route,
            autonomy: autonomyDecision,
            taskType
        });

        // ─────────────────────────────────────────────
        // 🧠 DECISÃO GLOBAL
        // ─────────────────────────────────────────────

        // PRIORIDADE 1: Se flow ativo → mantemos o flow
        if (flowActive) {
            return {
                strategy: CognitiveStrategy.FLOW,
                confidence: 1,
                reason: "flow_active",
                route: routeDecision,
                autonomy: autonomyDecision,
                memoryHits
            };
        }

        // PRIORIDADE 2: Se precisa de Tool (Ação no mundo real)
        if (routeDecision.route === ExecutionRoute.TOOL_LOOP) {
            if (autonomyDecision === AutonomyDecision.CONFIRM) {
                return {
                    strategy: CognitiveStrategy.CONFIRM,
                    confidence: 0.9,
                    reason: "tool_requires_confirmation",
                    route: routeDecision,
                    autonomy: autonomyDecision,
                    memoryHits
                };
            }

            if (autonomyDecision === AutonomyDecision.ASK) {
                return {
                    strategy: CognitiveStrategy.ASK,
                    confidence: 0.8,
                    reason: "missing_or_uncertain",
                    route: routeDecision,
                    autonomy: autonomyDecision,
                    memoryHits
                };
            }

            return {
                strategy: CognitiveStrategy.TOOL,
                confidence: routeDecision.confidence,
                reason: "tool_execution",
                route: routeDecision,
                autonomy: autonomyDecision,
                memoryHits
            };
        }

        // PRIORIDADE 3: Fallback LLM (Conversação direta)
        return {
            strategy: CognitiveStrategy.LLM,
            confidence: routeDecision.confidence,
            reason: "direct_response",
            route: routeDecision,
            autonomy: autonomyDecision,
            memoryHits
        };
    }

    private async safeMemoryQuery(input: string) {
        try {
            // Usa busca por conteúdo simples para decisão rápida no orquestrador
            return this.memoryService?.searchByContent(input, 5) || [];
        } catch {
            return [];
        }
    }

    private detectRisk(input: string): 'low' | 'medium' | 'high' {
        if (/delete|rm\s+|drop|format|remover|excluir|limpar/i.test(input)) return 'high';
        if (/install|write|create|update|instalar|criar|salvar|escrever/i.test(input)) return 'medium';
        return 'low';
    }

    private isDestructive(input: string): boolean {
        return /rm\s+|delete|remover|excluir|drop|wipe|erase|format/i.test(input);
    }
}
