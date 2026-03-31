import { createLogger } from '../../shared/AppLogger';
import { TaskNature } from './ActionRouter';

export enum UncertaintyType {
    NONE = 'none',
    INTENT = 'intent',        // Baixa confiança no que foi pedido
    EXECUTION = 'execution',   // Baixa confiança em como agir
    KNOWLEDGE = 'knowledge',   // Falta de base na memória/conhecimento
    CAPABILITY = 'capability', // Lacuna de ferramenta detectada
    CONFLICT = 'conflict'      // Intenção clara mas execução obscura (ou vice-versa)
}

export interface ConfidenceInput {
    classifierConfidence: number;
    routerConfidence: number;
    memoryHits?: any[];
    nature: TaskNature;
}

export interface AggregatedConfidence {
    score: number;
    level: 'low' | 'medium' | 'high';
    isConflict: boolean;
    uncertaintyType: UncertaintyType;
    factors: {
        classifier: number;
        router: number;
        memoryBonus: number;
        weights: {
            classifier: number;
            router: number;
        };
    };
}

/**
 * ConfidenceScorer: Centraliza a "Consciência de Confiança" do sistema.
 * Agrega múltiplos sinais de incerteza em um score cognitivo unificado.
 */
export class ConfidenceScorer {
    private logger = createLogger('ConfidenceScorer');

    /**
     * Agrega as confianças do sistema com pesos dinâmicos.
     */
    public calculate(input: ConfidenceInput): AggregatedConfidence {
        const { classifierConfidence, routerConfidence, memoryHits, nature } = input;

        // 1. Pesos Dinâmicos baseados na Natureza da Tarefa
        // Se é INFORMATIVA, a intenção importa mais que a rota de tool.
        // Se é EXECUTÁVEL, a rota (tool selector) é crítica.
        let weights = { classifier: 0.4, router: 0.6 };
        let selfQueryBonus = 0;

        if (nature === TaskNature.INFORMATIVE) {
            // Se o roteador está certo que é uma self-query/tool-query informativa (ex: "quem é você", "skills"),
            // não deixamos a incerteza do classificador pesar tanto.
            if (routerConfidence >= 1.0) {
                weights = { classifier: 0.3, router: 0.7 };
                selfQueryBonus = 0.15; // Bônus de "knows-itself" para self-queries
            } else {
                weights = { classifier: 0.7, router: 0.3 };
            }
        } else if (nature === TaskNature.EXECUTABLE) {
            weights = { classifier: 0.3, router: 0.7 };
        }

        const baseScore = (classifierConfidence * weights.classifier) + (routerConfidence * weights.router) + selfQueryBonus;

        // 2. Bônus de Memória (Placeholder para sucesso futuro)
        let memoryBonus = 0;
        if (memoryHits && memoryHits.length > 0) {
            const bestHit = memoryHits[0];
            if (bestHit.score > 0.8) {
                memoryBonus = 0.05;
            }
        }

        const finalScore = Math.min(1.0, baseScore + memoryBonus);

        // 3. Detecção de Conflito Interno
        // Se um é muito alto e outro muito baixo (> 0.4 de gap)
        const isConflict = Math.abs(classifierConfidence - routerConfidence) > 0.40;

        // 4. Diagnóstico de Incerteza
        let uncertaintyType = UncertaintyType.NONE;
        if (isConflict) {
            uncertaintyType = UncertaintyType.CONFLICT;
        } else if (classifierConfidence < 0.60) {
            uncertaintyType = UncertaintyType.INTENT;
        } else if (routerConfidence < 0.60) {
            uncertaintyType = UncertaintyType.EXECUTION;
        }

        // 5. Classificação de nível
        let level: 'low' | 'medium' | 'high' = 'low';
        if (finalScore >= 0.90) {
            level = 'high';
        } else if (finalScore >= 0.70) {
            level = 'medium';
        }

        const result: AggregatedConfidence = {
            score: finalScore,
            level,
            isConflict,
            uncertaintyType,
            factors: {
                classifier: classifierConfidence,
                router: routerConfidence,
                memoryBonus,
                weights
            }
        };

        this.logger.debug('confidence_diagnostic', `Score: ${finalScore.toFixed(2)} | Uncertainty: ${uncertaintyType}`, result.factors);

        return result;
    }
}
