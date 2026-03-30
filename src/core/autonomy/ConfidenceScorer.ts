import { createLogger } from '../../shared/AppLogger';

export interface ConfidenceInput {
    classifierConfidence: number;
    routerConfidence: number;
    memoryHits?: any[];
}

export interface AggregatedConfidence {
    score: number;
    level: 'low' | 'medium' | 'high';
    factors: {
        classifier: number;
        router: number;
        memoryBonus: number;
    };
}

/**
 * ConfidenceScorer: Centraliza a "Consciência de Confiança" do sistema.
 * Agrega múltiplos sinais de incerteza em um score cognitivo unificado.
 */
export class ConfidenceScorer {
    private logger = createLogger('ConfidenceScorer');

    /**
     * Agrega as confianças do sistema.
     * Fórmula: (Classifier * 0.4 + Router * 0.6) + MemoryBonus
     */
    public calculate(input: ConfidenceInput): AggregatedConfidence {
        const { classifierConfidence, routerConfidence, memoryHits } = input;

        // 1. Pesos base (Router tem mais peso na agibilidade)
        const baseScore = (classifierConfidence * 0.4) + (routerConfidence * 0.6);

        // 2. Bônus de Memória (Experiência passada gera certeza)
        let memoryBonus = 0;
        if (memoryHits && memoryHits.length > 0) {
            const bestHit = memoryHits[0];
            // Se o score da memória é alto (> 0.8), dá um bônus de 0.05
            if (bestHit.score > 0.8) {
                memoryBonus = 0.05;
            }
        }

        const finalScore = Math.min(1.0, baseScore + memoryBonus);

        // 3. Classificação de nível
        let level: 'low' | 'medium' | 'high' = 'low';
        if (finalScore >= 0.90) {
            level = 'high';
        } else if (finalScore >= 0.70) {
            level = 'medium';
        }

        const result: AggregatedConfidence = {
            score: finalScore,
            level,
            factors: {
                classifier: classifierConfidence,
                router: routerConfidence,
                memoryBonus
            }
        };

        this.logger.debug('confidence_aggregated', `Score: ${finalScore.toFixed(2)} (${level})`, result.factors);

        return result;
    }
}
