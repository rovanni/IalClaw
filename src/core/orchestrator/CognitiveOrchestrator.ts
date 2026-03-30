import { ActionRouter, ExecutionRoute, TaskNature } from '../autonomy/ActionRouter';
import { decideAutonomy, AutonomyDecision, AutonomyLevel, AutonomyContext } from '../autonomy/DecisionEngine';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { DecisionMemory } from '../../memory/DecisionMemory';
import { CapabilityResolver, ResolutionProposal } from '../autonomy/CapabilityResolver';
import { ConfidenceScorer, AggregatedConfidence } from '../autonomy/ConfidenceScorer';

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
    capabilityGap?: ResolutionProposal; // Lacuna detectada
    aggregatedConfidence?: AggregatedConfidence; // Score unificado
}

/**
 * CognitiveOrchestrator: Centraliza a tomada de decisão do agente.
 * Coordena entre fluxos guiados, execução de ferramentas e resposta direta via LLM.
 */
export class CognitiveOrchestrator {
    private logger = createLogger('CognitiveOrchestrator');
    private capabilityResolver = new CapabilityResolver();
    private confidenceScorer = new ConfidenceScorer();

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
        if (flowActive) {
            return {
                strategy: CognitiveStrategy.FLOW,
                confidence: 1,
                reason: "flow_active"
            };
        }

        // 2. Roteamento de Intenção (Determina se exige ação no mundo real)
        const routeDecision = this.actionRouter.decideRoute(text, taskType || null);

        // 3. Memória (Pesquisa rápida para contexto na decisão)
        const memoryHits = await this.safeMemoryQuery(text);

        // 4. Contexto de Autonomia (Baseado no risco e confiança)
        const policy = getSecurityPolicy().getPolicy(text);

        // 5. Capability Resolver (THINK: Detectar lacunas cognitivas/ferramentas)
        const capabilityGap = this.capabilityResolver.resolve(text, taskType || null, routeDecision.nature);

        // 6. Confidence Scorer (Agregação de incerteza com pesos dinâmicos)
        const aggregatedConfidence = this.confidenceScorer.calculate({
            classifierConfidence: input.taskType ? 0.95 : 0.60, // Fallback se taskType for nulo
            routerConfidence: routeDecision.confidence,
            memoryHits: memoryHits,
            nature: routeDecision.nature
        });

        // 7. Decision Engine (DECIDE: O que fazer baseado no risco, confiança e gaps)
        const autonomyContext: AutonomyContext = {
            intent: taskType || 'unknown',
            isContinuation: false, // Refinar com memória se necessário
            hasAllParams: true,
            riskLevel: policy.riskLevel as 'low' | 'medium' | 'high',
            isDestructive: policy.isDestructive,
            isReversible: true,
            confidence: aggregatedConfidence.score,
            autonomyLevel: context?.autonomyLevel || AutonomyLevel.BALANCED,
            intentSubtype: routeDecision.subtype,
            route: routeDecision.route,
            nature: routeDecision.nature,
            capabilityGap
        };

        const autonomyDecision = decideAutonomy(autonomyContext);

        this.logger.info('orchestration_decision', '[ORCHESTRATOR] Decisão de autonomia executada', {
            autonomyDecision,
            capabilityGap: capabilityGap.hasGap
        });

        // 7. Mapear Decisão para Estratégia de Execução (ACT)

        // PRIORIDADE 1: Perguntar ou Confirmar (DecisionEngine comanda)
        if (autonomyDecision === AutonomyDecision.ASK ||
            autonomyDecision === AutonomyDecision.ASK_CLARIFICATION ||
            autonomyDecision === AutonomyDecision.ASK_TOOL_SELECTION ||
            autonomyDecision === AutonomyDecision.ASK_EXECUTION_STRATEGY) {

            const strategyMap: Record<string, string> = {
                [AutonomyDecision.ASK_CLARIFICATION]: "intent_unclear",
                [AutonomyDecision.ASK_TOOL_SELECTION]: "execution_unclear",
                [AutonomyDecision.ASK_EXECUTION_STRATEGY]: "cognitive_conflict",
                [AutonomyDecision.ASK]: "low_confidence_fallback"
            };

            return {
                strategy: CognitiveStrategy.ASK,
                confidence: aggregatedConfidence.score,
                reason: strategyMap[autonomyDecision] || "autonomy_engine_ask",
                route: routeDecision,
                autonomy: autonomyDecision,
                memoryHits,
                aggregatedConfidence
            };
        }

        if (autonomyDecision === AutonomyDecision.CONFIRM) {
            return {
                strategy: CognitiveStrategy.CONFIRM,
                confidence: aggregatedConfidence.score,
                reason: capabilityGap.hasGap ? "capability_gap_detected" : "high_risk_confirmation",
                route: routeDecision,
                autonomy: autonomyDecision,
                memoryHits,
                capabilityGap,
                aggregatedConfidence
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

        // PRIORIDADE 3: Execução direta de Tool ou LLM
        if (routeDecision.route === ExecutionRoute.TOOL_LOOP) {
            return {
                strategy: CognitiveStrategy.TOOL,
                confidence: routeDecision.confidence,
                reason: "tool_execution",
                route: routeDecision,
                autonomy: autonomyDecision,
                memoryHits
            };
        }

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

        const heuristics: Record<string, string> = {
            'cripto': 'crypto-tracker',
            'crypto': 'crypto-tracker',
            'mercado': 'crypto-tracker',
            'bitcoin': 'crypto-tracker',
            'ethereum': 'crypto-tracker',
            'paxg': 'paxg-monitor',
            'ouro': 'paxg-monitor',
            'gold': 'paxg-monitor'
        };

        for (const [key, tool] of Object.entries(heuristics)) {
            if (text.includes(key)) return tool;
        }

        if (taskType === 'data_analysis') return 'crypto-tracker';

        return undefined;
    }
}
