// ── Classification Memory com Contexto ────────────────────────────────────────
// Memória adaptativa separada por contexto para evitar interferência entre domínios.

import { createLogger } from '../shared/AppLogger';

type MemoryContext = 'terminal' | 'coding' | 'chat' | 'analysis';

interface MemoryEntry {
    input: string;
    normalized: string;
    type: string;
    context: MemoryContext;       // Contexto da entrada
    confidence: number;
    hits: number;
    createdAt: number;
    lastUsed: number;
    penaltyCount: number;
    lastPenalized?: number;
}

interface ScoredEntry extends MemoryEntry {
    score: number;
}

interface FindResult {
    type: string;
    confidence: number;
    source: 'context' | 'global';  // Encontrado no contexto ou global
}

export class ClassificationMemory {
    private memory: MemoryEntry[] = [];
    private logger = createLogger('ClassificationMemory');
    
    // Configuração de decay
    private readonly MAX_ENTRIES = 200;
    private readonly MIN_SIMILARITY = 0.6;
    private readonly MIN_CONFIDENCE_TO_STORE = 0.80;
    private readonly HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
    private readonly PENALTY_AMOUNT = 2;
    private readonly MIN_HITS = 1;
    
    // Configuração de toxicidade
    private readonly TOXIC_PENALTY_THRESHOLD = 3;
    private readonly TOXIC_HIT_RATIO = 2;
    private readonly TOXIC_SCORE_PENALTY = 0.5;
    private readonly PENALTY_DECAY_FACTOR = 0.9;
    
    // Configuração de contexto
    private readonly GLOBAL_SCORE_PENALTY = 0.1;  // Redução de score para matches globais

    // ═══════════════════════════════════════════════════════════════════════
    // DETECÇÃO DE CONTEXTO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Detecta o contexto de um input.
     * terminal → comandos (npm, npx, bash)
     * coding → código (function, class, {})
     * chat → perguntas (?)
     * analysis → default
     */
    private detectContext(input: string): MemoryContext {
        const normalized = input.toLowerCase();

        // Terminal: comandos de shell
        if (/\b(npm|npx|yarn|pnpm|pip|apt|brew|git|docker|kubectl|bash|sh|sudo)\b/.test(normalized)) {
            return 'terminal';
        }
        if (/\b(install|run|build|start|stop|exec|execute)\b/.test(normalized)) {
            return 'terminal';
        }
        if (/^\s*\$/.test(normalized) || /^\s*>\s*\w/.test(normalized)) {
            return 'terminal';
        }

        // Coding: código fonte
        if (/\b(function|class|interface|type|const|let|var|def|async|await)\b/.test(normalized)) {
            return 'coding';
        }
        if (/[{}()\[\];]/.test(normalized) && /\b(return|if|else|for|while)\b/.test(normalized)) {
            return 'coding';
        }
        if (/\.(ts|js|py|go|rs|java|cpp|c)\b/.test(normalized)) {
            return 'coding';
        }

        // Chat: perguntas
        if (/\?\s*$/.test(normalized)) {
            return 'chat';
        }
        if (/^(o que|qual|como|quando|onde|por que|porque|what|how|when|where|why)/i.test(normalized)) {
            return 'chat';
        }

        // Default: análise geral
        return 'analysis';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TOXICIDADE
    // ═══════════════════════════════════════════════════════════════════════

    private isToxic(entry: MemoryEntry): boolean {
        if (entry.penaltyCount < this.TOXIC_PENALTY_THRESHOLD) {
            return false;
        }
        return entry.penaltyCount >= this.TOXIC_PENALTY_THRESHOLD && 
               entry.hits < entry.penaltyCount * this.TOXIC_HIT_RATIO;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CORE
    // ═══════════════════════════════════════════════════════════════════════

    private normalize(text: string): string {
        return text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    }

    private similarity(a: string, b: string): number {
        const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2));
        const bWords = new Set(b.split(/\s+/).filter(w => w.length > 2));

        if (aWords.size === 0 || bWords.size === 0) return 0;

        const intersection = [...aWords].filter(w => bWords.has(w)).length;
        const union = new Set([...aWords, ...bWords]).size;

        return union === 0 ? 0 : intersection / union;
    }

    private computeRecencyWeight(lastUsed: number): number {
        const age = Date.now() - lastUsed;
        return Math.exp(-age / this.HALF_LIFE_MS);
    }

    private computeScore(entry: MemoryEntry, similarity: number, isGlobal: boolean = false): number {
        const recencyWeight = this.computeRecencyWeight(entry.lastUsed);
        const frequencyScore = Math.log(entry.hits + 1);
        
        const age = Date.now() - entry.createdAt;
        const agePenalty = Math.min(0.2, age / (30 * 24 * 60 * 60 * 1000));
        
        let score = (
            similarity * 0.5 +
            frequencyScore * 0.2 +
            recencyWeight * 0.3 -
            agePenalty
        );

        // Penalização para matches globais (fora do contexto)
        if (isGlobal) {
            score -= this.GLOBAL_SCORE_PENALTY;
        }

        // Penalização adicional para entradas tóxicas
        if (this.isToxic(entry)) {
            score -= this.TOXIC_SCORE_PENALTY;
        }

        return score;
    }

    private applyPenaltyDecay(): void {
        const now = Date.now();
        const decayThreshold = 24 * 60 * 60 * 1000;

        for (const entry of this.memory) {
            if (entry.penaltyCount > 0 && entry.lastPenalized) {
                const timeSincePenalty = now - entry.lastPenalized;
                
                if (timeSincePenalty > decayThreshold) {
                    entry.penaltyCount = Math.floor(entry.penaltyCount * this.PENALTY_DECAY_FACTOR);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FIND - BUSCA POR CONTEXTO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Busca classificação similar na memória.
     * Prioriza contexto específico, com fallback global.
     */
    find(input: string): FindResult | null {
        const normalized = this.normalize(input);
        const context = this.detectContext(input);
        const now = Date.now();

        this.applyPenaltyDecay();

        // ═══════════════════════════════════════════════════════════════
        // PASSO 1: Buscar no contexto específico
        // ═══════════════════════════════════════════════════════════════
        let best: MemoryEntry | null = null;
        let bestScore = 0;
        let bestSimilarity = 0;
        let foundInContext = false;

        for (const entry of this.memory) {
            if (this.isToxic(entry)) continue;

            // Filtrar por contexto
            if (entry.context !== context) continue;

            const sim = this.similarity(normalized, entry.normalized);
            if (sim >= this.MIN_SIMILARITY) {
                const score = this.computeScore(entry, sim, false);
                if (score > bestScore) {
                    best = entry;
                    bestScore = score;
                    bestSimilarity = sim;
                    foundInContext = true;
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // PASSO 2: Fallback global (se não encontrou no contexto)
        // ═══════════════════════════════════════════════════════════════
        if (!foundInContext) {
            for (const entry of this.memory) {
                if (this.isToxic(entry)) continue;

                const sim = this.similarity(normalized, entry.normalized);
                if (sim >= this.MIN_SIMILARITY) {
                    const score = this.computeScore(entry, sim, true); // isGlobal = true
                    if (score > bestScore) {
                        best = entry;
                        bestScore = score;
                        bestSimilarity = sim;
                        foundInContext = false;
                    }
                }
            }
        }

        if (best) {
            best.hits++;
            best.lastUsed = now;

            const hitBoost = Math.min(0.15, best.hits * 0.03);
            const recencyBoost = this.computeRecencyWeight(best.lastUsed) * 0.05;
            const finalConfidence = Math.min(1, bestSimilarity + 0.2 + hitBoost + recencyBoost);

            this.logger.info('memory_hit', 'Classificação reutilizada', {
                type: best.type,
                context: best.context,
                source: foundInContext ? 'context' : 'global',
                similarity: bestSimilarity.toFixed(2),
                score: bestScore.toFixed(2),
                hits: best.hits,
                input_preview: input.slice(0, 50)
            });

            return {
                type: best.type,
                confidence: finalConfidence,
                source: foundInContext ? 'context' : 'global'
            };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STORE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Armazena uma classificação com contexto.
     */
    store(input: string, type: string, confidence: number): void {
        if (confidence < this.MIN_CONFIDENCE_TO_STORE) {
            return;
        }

        const normalized = this.normalize(input);
        const context = this.detectContext(input);
        const now = Date.now();

        // Verificar se já existe entrada similar no mesmo contexto
        const existing = this.memory.find(e => 
            e.context === context &&
            (e.normalized === normalized || this.similarity(normalized, e.normalized) > 0.9)
        );

        if (existing) {
            existing.hits++;
            existing.lastUsed = now;
            existing.confidence = Math.max(existing.confidence, confidence);
            
            if (existing.penaltyCount > 0) {
                existing.penaltyCount = Math.max(0, existing.penaltyCount - 1);
            }
            
            this.logger.debug('memory_update', 'Classificação atualizada', {
                type,
                context,
                hits: existing.hits,
                input_preview: input.slice(0, 50)
            });
            return;
        }

        this.memory.push({
            input: input.slice(0, 200),
            normalized,
            type,
            context,
            confidence,
            hits: 1,
            createdAt: now,
            lastUsed: now,
            penaltyCount: 0
        });

        this.logger.info('memory_store', 'Nova classificação aprendida', {
            type,
            context,
            confidence: confidence.toFixed(2),
            total_entries: this.memory.length,
            input_preview: input.slice(0, 50)
        });

        if (this.memory.length > this.MAX_ENTRIES) {
            this.evict();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PENALIZE
    // ═══════════════════════════════════════════════════════════════════════

    penalize(input: string, type: string): void {
        const normalized = this.normalize(input);
        const context = this.detectContext(input);
        const now = Date.now();

        const entry = this.memory.find(e => 
            e.type === type && 
            e.context === context &&
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
                context,
                hits: entry.hits,
                penalty_count: entry.penaltyCount,
                is_toxic: isNowToxic
            });

            if (!wasToxic && isNowToxic) {
                this.logger.warn('memory_toxic_detected', 'Padrão tóxico detectado', {
                    type,
                    context,
                    input_preview: input.slice(0, 50)
                });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EVICT
    // ═══════════════════════════════════════════════════════════════════════

    private evict(): void {
        this.applyPenaltyDecay();

        const scored: ScoredEntry[] = this.memory.map(entry => ({
            ...entry,
            score: this.computeScore(entry, this.similarity(entry.normalized, entry.normalized), false)
        }));

        scored.sort((a, b) => a.score - b.score);

        const removeCount = Math.floor(this.MAX_ENTRIES * 0.2);
        this.memory = this.memory.filter(entry => {
            const score = this.computeScore(entry, this.similarity(entry.normalized, entry.normalized), false);
            return score > scored[removeCount - 1]?.score;
        });

        const stats = this.stats();
        this.logger.debug('memory_evict', 'Eviction por score', {
            removed: removeCount,
            remaining: this.memory.length,
            by_context: stats.byContext
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STATS
    // ═══════════════════════════════════════════════════════════════════════

    stats(): { 
        entries: number;
        byType: Record<string, number>;
        byContext: Record<string, number>;
        avgAge: number;
        avgHits: number;
        toxicCount: number;
        avgPenalty: number;
    } {
        const byType: Record<string, number> = {};
        const byContext: Record<string, number> = {};
        let totalAge = 0;
        let totalHits = 0;
        let totalPenalty = 0;
        let toxicCount = 0;

        for (const entry of this.memory) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
            byContext[entry.context] = (byContext[entry.context] || 0) + 1;
            totalAge += Date.now() - entry.createdAt;
            totalHits += entry.hits;
            totalPenalty += entry.penaltyCount;
            if (this.isToxic(entry)) toxicCount++;
        }

        return {
            entries: this.memory.length,
            byType,
            byContext,
            avgAge: this.memory.length > 0 ? totalAge / this.memory.length : 0,
            avgHits: this.memory.length > 0 ? totalHits / this.memory.length : 0,
            toxicCount,
            avgPenalty: this.memory.length > 0 ? totalPenalty / this.memory.length : 0
        };
    }

    clear(): void {
        this.memory = [];
        this.logger.info('memory_clear', 'Memória limpa');
    }

    inspect(): MemoryEntry[] {
        return [...this.memory];
    }

    getToxicEntries(): MemoryEntry[] {
        return this.memory.filter(e => this.isToxic(e));
    }

    /**
     * Retorna entradas por contexto para debug.
     */
    getByContext(context: MemoryContext): MemoryEntry[] {
        return this.memory.filter(e => e.context === context);
    }
}

// Singleton
let classificationMemoryInstance: ClassificationMemory | null = null;

export function getClassificationMemory(): ClassificationMemory {
    if (!classificationMemoryInstance) {
        classificationMemoryInstance = new ClassificationMemory();
    }
    return classificationMemoryInstance;
}