// ── Classification Memory com Decay Temporal ─────────────────────────────────
// Memória adaptativa com controle de qualidade ao longo do tempo.
// Evita viés acumulado, reforço de erro e drift semântico.

import { createLogger } from '../shared/AppLogger';

interface MemoryEntry {
    input: string;
    normalized: string;
    type: string;
    confidence: number;
    hits: number;
    createdAt: number;
    lastUsed: number;
    lastPenalized?: number;
}

interface ScoredEntry extends MemoryEntry {
    score: number;
}

export class ClassificationMemory {
    private memory: MemoryEntry[] = [];
    private logger = createLogger('ClassificationMemory');
    
    // Configuração de decay
    private readonly MAX_ENTRIES = 200;
    private readonly MIN_SIMILARITY = 0.6;
    private readonly MIN_CONFIDENCE_TO_STORE = 0.80;
    private readonly HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias em ms
    private readonly PENALTY_AMOUNT = 2;
    private readonly MIN_HITS = 1; // Mínimo para não ser removido

    /**
     * Normaliza texto para comparação.
     */
    private normalize(text: string): string {
        return text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    }

    /**
     * Calcula similaridade Jaccard entre dois textos.
     */
    private similarity(a: string, b: string): number {
        const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2));
        const bWords = new Set(b.split(/\s+/).filter(w => w.length > 2));

        if (aWords.size === 0 || bWords.size === 0) return 0;

        const intersection = [...aWords].filter(w => bWords.has(w)).length;
        const union = new Set([...aWords, ...bWords]).size;

        return union === 0 ? 0 : intersection / union;
    }

    /**
     * Calcula o peso de recência (decay temporal).
     * Entradas mais recentes têm peso maior.
     */
    private computeRecencyWeight(lastUsed: number): number {
        const age = Date.now() - lastUsed;
        return Math.exp(-age / this.HALF_LIFE_MS);
    }

    /**
     * Calcula o score dinâmico de uma entrada.
     * Combina: similaridade + frequência (log) + recência
     */
    private computeScore(entry: MemoryEntry, similarity: number): number {
        const recencyWeight = this.computeRecencyWeight(entry.lastUsed);
        const frequencyScore = Math.log(entry.hits + 1);
        
        // Penalização por idade
        const age = Date.now() - entry.createdAt;
        const agePenalty = Math.min(0.2, age / (30 * 24 * 60 * 60 * 1000)); // Max 0.2 após 30 dias
        
        return (
            similarity * 0.5 +
            frequencyScore * 0.2 +
            recencyWeight * 0.3 -
            agePenalty
        );
    }

    /**
     * Busca classificação similar na memória usando score dinâmico.
     */
    find(input: string): { type: string; confidence: number } | null {
        const normalized = this.normalize(input);
        const now = Date.now();

        let best: MemoryEntry | null = null;
        let bestScore = 0;
        let bestSimilarity = 0;

        for (const entry of this.memory) {
            const sim = this.similarity(normalized, entry.normalized);

            if (sim >= this.MIN_SIMILARITY) {
                const score = this.computeScore(entry, sim);

                if (score > bestScore) {
                    best = entry;
                    bestScore = score;
                    bestSimilarity = sim;
                }
            }
        }

        if (best) {
            // Atualizar uso
            best.hits++;
            best.lastUsed = now;

            // Boost de confiança por hits (máximo +0.15)
            const hitBoost = Math.min(0.15, best.hits * 0.03);
            
            // Boost de recência
            const recencyBoost = this.computeRecencyWeight(best.lastUsed) * 0.05;

            const finalConfidence = Math.min(1, bestSimilarity + 0.2 + hitBoost + recencyBoost);

            this.logger.info('memory_hit', 'Classificação reutilizada da memória', {
                type: best.type,
                similarity: bestSimilarity.toFixed(2),
                score: bestScore.toFixed(2),
                hits: best.hits,
                age_hours: Math.round((now - best.createdAt) / (60 * 60 * 1000)),
                confidence: finalConfidence.toFixed(2),
                input_preview: input.slice(0, 50)
            });

            return {
                type: best.type,
                confidence: finalConfidence
            };
        }

        return null;
    }

    /**
     * Armazena uma classificação bem-sucedida na memória.
     */
    store(input: string, type: string, confidence: number): void {
        // Só aprender classificações com alta confiança
        if (confidence < this.MIN_CONFIDENCE_TO_STORE) {
            return;
        }

        const normalized = this.normalize(input);
        const now = Date.now();

        // Verificar se já existe entrada similar
        const existing = this.memory.find(e => 
            e.normalized === normalized || 
            this.similarity(normalized, e.normalized) > 0.9
        );

        if (existing) {
            existing.hits++;
            existing.lastUsed = now;
            existing.confidence = Math.max(existing.confidence, confidence);
            
            this.logger.debug('memory_update', 'Classificação atualizada', {
                type,
                hits: existing.hits,
                input_preview: input.slice(0, 50)
            });
            return;
        }

        // Nova entrada
        this.memory.push({
            input: input.slice(0, 200),
            normalized,
            type,
            confidence,
            hits: 1,
            createdAt: now,
            lastUsed: now
        });

        this.logger.info('memory_store', 'Nova classificação aprendida', {
            type,
            confidence: confidence.toFixed(2),
            total_entries: this.memory.length,
            input_preview: input.slice(0, 50)
        });

        // Eviction por score (não FIFO)
        if (this.memory.length > this.MAX_ENTRIES) {
            this.evict();
        }
    }

    /**
     * Penaliza uma entrada quando o LLM discorda.
     * Evita reforço de erro.
     */
    penalize(input: string, type: string): void {
        const normalized = this.normalize(input);

        const entry = this.memory.find(e => 
            e.type === type && 
            this.similarity(normalized, e.normalized) > 0.8
        );

        if (entry) {
            entry.hits = Math.max(this.MIN_HITS, entry.hits - this.PENALTY_AMOUNT);
            entry.lastPenalized = Date.now();
            
            this.logger.info('memory_penalize', 'Classificação penalizada', {
                type,
                hits: entry.hits,
                input_preview: input.slice(0, 50)
            });

            // Se hits ficou muito baixo, remover na próxima eviction
            if (entry.hits <= 0) {
                this.logger.warn('memory_toxic', 'Padrão marcado como tóxico', {
                    type,
                    input_preview: input.slice(0, 50)
                });
            }
        }
    }

    /**
     * Remove entradas com menor score (eviction inteligente).
     * Prioriza remover: antigas, pouco usadas, penalizadas.
     */
    private evict(): void {
        const now = Date.now();
        
        // Calcular score para todas as entradas
        const scored: ScoredEntry[] = this.memory.map(entry => ({
            ...entry,
            score: this.computeScore(entry, this.similarity(entry.normalized, entry.normalized))
        }));

        // Ordenar por score (menor primeiro)
        scored.sort((a, b) => a.score - b.score);

        // Remover as 20% com menor score
        const removeCount = Math.floor(this.MAX_ENTRIES * 0.2);
        const toRemove = scored.slice(0, removeCount);
        const removeTypes = new Set(toRemove.map(e => e.type));

        // Filtrar mantendo as de maior score
        this.memory = this.memory.filter(entry => {
            const score = this.computeScore(entry, this.similarity(entry.normalized, entry.normalized));
            return score > scored[removeCount - 1]?.score;
        });

        // Log de estatísticas
        const stats = this.stats();
        this.logger.debug('memory_evict', 'Eviction por score', {
            removed: removeCount,
            remaining: this.memory.length,
            by_type: stats.byType
        });
    }

    /**
     * Retorna estatísticas da memória.
     */
    stats(): { entries: number; byType: Record<string, number>; avgAge: number; avgHits: number } {
        const byType: Record<string, number> = {};
        let totalAge = 0;
        let totalHits = 0;

        for (const entry of this.memory) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            totalAge += Date.now() - entry.createdAt;
            totalHits += entry.hits;
        }

        return {
            entries: this.memory.length,
            byType,
            avgAge: this.memory.length > 0 ? totalAge / this.memory.length : 0,
            avgHits: this.memory.length > 0 ? totalHits / this.memory.length : 0
        };
    }

    /**
     * Limpa a memória (útil para testes).
     */
    clear(): void {
        this.memory = [];
        this.logger.info('memory_clear', 'Memória de classificação limpa');
    }

    /**
     * Retorna entradas para debug/inspeção.
     */
    inspect(): MemoryEntry[] {
        return [...this.memory];
    }
}

// Singleton para uso global
let classificationMemoryInstance: ClassificationMemory | null = null;

export function getClassificationMemory(): ClassificationMemory {
    if (!classificationMemoryInstance) {
        classificationMemoryInstance = new ClassificationMemory();
    }
    return classificationMemoryInstance;
}