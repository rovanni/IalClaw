import { ActionRouter, ExecutionRoute, TaskNature } from '../autonomy/ActionRouter';
import { decideAutonomy, AutonomyDecision, AutonomyLevel } from '../autonomy/DecisionEngine';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { DecisionMemory } from '../../memory/DecisionMemory';

export enum CognitiveStrategy {
    FLOW = "flow",
    TOOL = "tool",
    LLM = "llm",
    HYBRID = "hybrid",      // LLM + Tool opcional
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
    suggestedTool?: string; // Sugestão para estratégia HYBRID
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
        private flowManager: FlowManager,
        private decisionMemory?: DecisionMemory | null
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
        const policy = getSecurityPolicy().getPolicy(text);

        // REFINAMENTO: Usar memória para detectar continuidade
        let isContinuation = false;
        let confidenceBonus = 0;

        if (this.decisionMemory && taskType) {
            const stats: any = await this.decisionMemory.getToolStats(taskType);
            const totalSuccesses = stats.reduce((acc: number, s: any) => acc + s.successes, 0);
            const totalDecisions = stats.reduce((acc: number, s: any) => acc + s.total, 0);

            if (totalDecisions > 5 && (totalSuccesses / totalDecisions) > 0.8) {
                confidenceBonus = 0.05; // Pequeno bônus por sucesso histórico
            }
        }

        const autonomyCtx = {
            intent: taskType || "unknown",
            isContinuation,
            hasAllParams: true,    // Assumimos true para a decisão de orquestração básica
            riskLevel: policy.riskLevel,
            isDestructive: policy.isDestructive,
            isReversible: true,    // Placeholder
            confidence: Math.min(1.0, routeDecision.confidence + confidenceBonus),
            intentSubtype: routeDecision.subtype,
            route: routeDecision.route,
            nature: routeDecision.nature,
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

        // "Não basta saber o que fazer — precisa saber quando fazer sem pedir permissão."

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

        // PRIORIDADE 2: Se é tarefa HÍBRIDA (Responde e depois sugere/usa tool)
        if (routeDecision.nature === TaskNature.HYBRID) {
            const suggestedTool = this.suggestHybridTool(text, taskType || null);
            return {
                strategy: CognitiveStrategy.HYBRID,
                confidence: 0.9,
                reason: "hybrid_informative_executable",
                route: routeDecision,
                autonomy: autonomyDecision,
                memoryHits,
                suggestedTool
            };
        }

        // PRIORIDADE 3: Se precisa de Tool (Ação no mundo real)
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

        // PRIORIDADE 4: Fallback LLM (Conversação direta)
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

    /**
     * Sugere uma ferramenta para tarefas híbridas.
     */
    private suggestHybridTool(input: string, taskType: TaskType | null): string | undefined {
        const text = input.toLowerCase();

        // Mapeamento heurístico de ferramentas para o orquestrador
        const heuristics: Record<string, string> = {
            'cripto': 'crypto-tracker',
            'crypto': 'crypto-tracker',
            'mercado': 'crypto-tracker', // Simplificação para o exemplo
            'bitcoin': 'crypto-tracker',
            'ethereum': 'crypto-tracker',
            'paxg': 'paxg-monitor',
            'ouro': 'paxg-monitor',
            'gold': 'paxg-monitor'
        };

        for (const [key, tool] of Object.entries(heuristics)) {
            if (text.includes(key)) return tool;
        }

        // Fallback baseado no taskType se for data_analysis
        if (taskType === 'data_analysis') return 'crypto-tracker';

        return undefined;
    }
}
