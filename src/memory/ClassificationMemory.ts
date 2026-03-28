// ── Classification Memory com Decay Temporal + Detecção de Padrões Tóxicos ────
// Memória adaptativa com controle de qualidade e prevenção de loops de erro.

import { createLogger } from '../shared/AppLogger';

interface MemoryEntry {
    input: string;
    normalized: string;
    type: string;
    confidence: number;
    hits: number;
    createdAt: number;
    lastUsed: number;
    penaltyCount: number;      // Contador de penalizações
    lastPenalized?: number;    // Última penalização
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
    private readonly MIN_HITS = 1;
    
    // Configuração de toxicidade
    private readonly TOXIC_PENALTY_THRESHOLD = 3;    // Penalizações para ser tóxico
    private readonly TOXIC_HIT_RATIO = 2;             // hits < penaltyCount * 2 = tóxico
    private readonly TOXIC_SCORE_PENALTY = 0.5;       // Redução de score para tóxicos
    private readonly PENALTY_DECAY_FACTOR = 0.9;      // Decay de penalidade por período

    /**
     * Verifica se uma entrada é tóxica.
     * Tóxico = frequentemente penalizada + baixa confiabilidade.
     */
    private isToxic(entry: MemoryEntry): boolean {
        // Muitas penalizações
        if (entry.penaltyCount < this.TOXIC_PENALTY_THRESHOLD) {
            return false;
        }

        // Hits muito baixos em relação a penalizações
        const hitRatio = entry.hits / Math.max(1, entry.penaltyCount);
        
        // Tóxico se: penalizado >= 3 vezes E hits < penaltyCount * 2
        return entry.penaltyCount >= this.TOXIC_PENALTY_THRESHOLD && 
               entry.hits < entry.penaltyCount * this.TOXIC_HIT_RATIO;
    }

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
     */
    private computeRecencyWeight(lastUsed: number): number {
        const age = Date.now() - lastUsed;
        return Math.exp(-age / this.HALF_LIFE_MS);
    }

    /**
     * Calcula o score dinâmico de uma entrada.
     * Combina: similaridade + frequência + recência - toxicidade
     */
    private computeScore(entry: MemoryEntry, similarity: number): number {
        const recencyWeight = this.computeRecencyWeight(entry.lastUsed);
        const frequencyScore = Math.log(entry.hits + 1);
        
        // Penalização por idade
        const age = Date.now() - entry.createdAt;
        const agePenalty = Math.min(0.2, age / (30 * 24 * 60 * 60 * 1000));
        
        let score = (
            similarity * 0.5 +
            frequencyScore * 0.2 +
            recencyWeight * 0.3 -
            agePenalty
        );

        // Penalização adicional para entradas tóxicas
        if (this.isToxic(entry)) {
            score -= this.TOXIC_SCORE_PENALTY;
        }

        return score;
    }

    /**
     * Aplica decay às penalidades periodicamente.
     * Reduz penaltyCount para permitir recuperação.
     */
    private applyPenaltyDecay(): void {
        const now = Date.now();
        const decayThreshold = 24 * 60 * 60 * 1000; // 1 dia

        for (const entry of this.memory) {
            if (entry.penaltyCount > 0 && entry.lastPenalized) {
                const timeSincePenalty = now - entry.lastPenalized;
                
                if (timeSincePenalty > decayThreshold) {
                    const oldPenalty = entry.penaltyCount;
                    entry.penaltyCount = Math.floor(entry.penaltyCount * this.PENALTY_DECAY_FACTOR);
                    
                    if (entry.penaltyCount < oldPenalty) {
                        this.logger.debug('penalty_decay', 'Penalidade decaída', {
                            type: entry.type,
                            old_penalty: oldPenalty,
                            new_penalty: entry.penaltyCount,
                            input_preview: entry.input.slice(0, 30)
                        });
                    }
                }
            }
        }
    }

    /**
     * Busca classificação similar na memória usando score dinâmico.
     * Ignora entradas tóxicas.
     */
    find(input: string): { type: string; confidence: number } | null {
        const normalized = this.normalize(input);
        const now = Date.now();

        // Aplicar decay de penalidades periodicamente
        this.applyPenaltyDecay();

        let best: MemoryEntry | null = null;
        let bestScore = 0;
        let bestSimilarity = 0;

        for (const entry of this.memory) {
            // Ignorar entradas tóxicas
            if (this.isToxic(entry)) {
                this.logger.debug('skip_toxic', 'Entrada tóxica ignorada', {
                    type: entry.type,
                    penalty_count: entry.penaltyCount,
                    hits: entry.hits,
                    input_preview: entry.input.slice(0, 30)
                });
                continue;
            }

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
                penalty_count: best.penaltyCount,
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
            
            // Recuperar de toxicidade se estava penalizado mas agora está sendo reutilizado
            if (existing.penaltyCount > 0) {
                existing.penaltyCount = Math.max(0, existing.penaltyCount - 1);
            }
            
            this.logger.debug('memory_update', 'Classificação atualizada', {
                type,
                hits: existing.hits,
                penalty_count: existing.penaltyCount,
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
            lastUsed: now,
            penaltyCount: 0
        });

        this.logger.info('memory_store', 'Nova classificação aprendida', {
            type,
            confidence: confidence.toFixed(2),
            total_entries: this.memory.length,
            input_preview: input.slice(0, 50)
        });

        // Eviction por score
        if (this.memory.length > this.MAX_ENTRIES) {
            this.evict();
        }
    }

    /**
     * Penaliza uma entrada quando o LLM discorda.
     * Detecta padrões tóxicos persistentes.
     */
    penalize(input: string, type: string): void {
        const normalized = this.normalize(input);
        const now = Date.now();

        const entry = this.memory.find(e => 
            e.type === type && 
            this.similarity(normalized, e.normalized) > 0.8
        );

        if (entry) {
            const wasToxic = this.isToxic(entry);
            
            entry.hits = Math.max(this.MIN_HITS, entry.hits - this.PENALTY_AMOUNT);
            entry.penaltyCount++;
            entry.lastPenalized = now;

            const isNowToxic = this.isToxic(entry);

            this.logger.info('memory_penalize', 'Classificação penalizada', {
                type,
                hits: entry.hits,
                penalty_count: entry.penaltyCount,
                is_toxic: isNowToxic,
                input_preview: input.slice(0, 50)
            });

            // Log especial se acabou de se tornar tóxico
            if (!wasToxic && isNowToxic) {
                this.logger.warn('memory_toxic_detected', 'Padrão tóxico detectado e neutralizado', {
                    type,
                    penalty_count: entry.penaltyCount,
                    hits: entry.hits,
                    input_preview: input.slice(0, 50)
                });
            }
        }
    }

    /**
     * Remove entradas com menor score (eviction inteligente).
     * Prioriza remover: tóxicas, antigas, pouco usadas.
     */
    private evict(): void {
        const now = Date.now();
        
        // Aplicar decay antes de eviction
        this.applyPenaltyDecay();

        // Calcular score para todas as entradas
        const scored: ScoredEntry[] = this.memory.map(entry => ({
            ...entry,
            score: this.computeScore(entry, this.similarity(entry.normalized, entry.normalized))
        }));

        // Ordenar por score (menor primeiro) - tóxicas têm score menor
        scored.sort((a, b) => a.score - b.score);

        // Remover as 20% com menor score
        const removeCount = Math.floor(this.MAX_ENTRIES * 0.2);
        const toRemove = scored.slice(0, removeCount);
        const toxicRemoved = toRemove.filter(e => this.isToxic(e)).length;

        // Filtrar mantendo as de maior score
        this.memory = this.memory.filter(entry => {
            const score = this.computeScore(entry, this.similarity(entry.normalized, entry.normalized));
            return score > scored[removeCount - 1]?.score;
        });

        // Log de estatísticas
        const stats = this.stats();
        this.logger.debug('memory_evict', 'Eviction por score', {
            removed: removeCount,
            toxic_removed: toxicRemoved,
            remaining: this.memory.length,
            by_type: stats.byType,
            toxic_count: stats.toxicCount
        });
    }

    /**
     * Retorna estatísticas da memória.
     */
    stats(): { 
        entries: number; 
        byType: Record<string, number>; 
        avgAge: number; 
        avgHits: number;
        toxicCount: number;
        avgPenalty: number;
    } {
        const byType: Record<string, number> = {};
        let totalAge = 0;
        let totalHits = 0;
        let totalPenalty = 0;
        let toxicCount = 0;

        for (const entry of this.memory) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            totalAge += Date.now() - entry.createdAt;
            totalHits += entry.hits;
            totalPenalty += entry.penaltyCount;
            if (this.isToxic(entry)) toxicCount++;
        }

        return {
            entries: this.memory.length,
            byType,
            avgAge: this.memory.length > 0 ? totalAge / this.memory.length : 0,
            avgHits: this.memory.length > 0 ? totalHits / this.memory.length : 0,
            toxicCount,
            avgPenalty: this.memory.length > 0 ? totalPenalty / this.memory.length : 0
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

    /**
     * Retorna entradas tóxicas para análise.
     */
    getToxicEntries(): MemoryEntry[] {
        return this.memory.filter(e => this.isToxic(e));
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