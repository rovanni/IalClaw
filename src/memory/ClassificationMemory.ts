// ── Classification Memory ─────────────────────────────────────────────────
// Aprendizado adaptativo de classificação sem embeddings.
// Aprende com execuções bem-sucedidas e reconhece padrões semelhantes.

import { createLogger } from '../shared/AppLogger';

interface MemoryEntry {
    input: string;
    normalized: string;
    type: string;
    confidence: number;
    hits: number;
    lastUsed: number;
    createdAt: number;
}

export class ClassificationMemory {
    private memory: MemoryEntry[] = [];
    private logger = createLogger('ClassificationMemory');
    private readonly MAX_ENTRIES = 200;
    private readonly MIN_SIMILARITY = 0.6;
    private readonly MIN_CONFIDENCE_TO_STORE = 0.80;

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
     * Busca classificação similar na memória.
     * Retorna null se não encontrar match com similaridade >= MIN_SIMILARITY.
     */
    find(input: string): { type: string; confidence: number } | null {
        const normalized = this.normalize(input);

        let best: MemoryEntry | null = null;
        let bestScore = 0;

        for (const entry of this.memory) {
            const score = this.similarity(normalized, entry.normalized);

            if (score > bestScore && score >= this.MIN_SIMILARITY) {
                best = entry;
                bestScore = score;
            }
        }

        if (best) {
            best.hits++;
            best.lastUsed = Date.now();

            this.logger.info('memory_hit', 'Classificação reutilizada da memória', {
                type: best.type,
                similarity: bestScore.toFixed(2),
                hits: best.hits,
                input_preview: input.slice(0, 50)
            });

            // Boost confidence based on hits (máximo +0.15)
            const hitBoost = Math.min(0.15, best.hits * 0.03);
            
            return {
                type: best.type,
                confidence: Math.min(1, bestScore + 0.2 + hitBoost)
            };
        }

        return null;
    }

    /**
     * Armazena uma classificação bem-sucedida na memória.
     * Só armazena se:
     * - confidence >= MIN_CONFIDENCE_TO_STORE
     * - não for fallback
     */
    store(input: string, type: string, confidence: number): void {
        // Só aprender classificações com alta confiança
        if (confidence < this.MIN_CONFIDENCE_TO_STORE) {
            return;
        }

        const normalized = this.normalize(input);

        // Verificar se já existe entrada similar
        const existing = this.memory.find(e => 
            e.normalized === normalized || 
            this.similarity(normalized, e.normalized) > 0.9
        );

        if (existing) {
            existing.hits++;
            existing.lastUsed = Date.now();
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
            input: input.slice(0, 200), // Limitar tamanho
            normalized,
            type,
            confidence,
            hits: 1,
            lastUsed: Date.now(),
            createdAt: Date.now()
        });

        this.logger.info('memory_store', 'Nova classificação aprendida', {
            type,
            confidence: confidence.toFixed(2),
            total_entries: this.memory.length,
            input_preview: input.slice(0, 50)
        });

        // Limite de memória (FIFO)
        if (this.memory.length > this.MAX_ENTRIES) {
            this.evict();
        }
    }

    /**
     * Remove entradas antigas ou pouco usadas quando a memória está cheia.
     */
    private evict(): void {
        // Ordenar por: hits (asc) + lastUsed (asc)
        // Remove as menos usadas e mais antigas
        this.memory.sort((a, b) => {
            const scoreA = a.hits * 0.3 + (Date.now() - a.lastUsed) * -0.00001;
            const scoreB = b.hits * 0.3 + (Date.now() - b.lastUsed) * -0.00001;
            return scoreA - scoreB;
        });

        const removed = this.memory.splice(0, Math.floor(this.MAX_ENTRIES * 0.2));
        
        this.logger.debug('memory_evict', 'Entradas removidas da memória', {
            removed: removed.length,
            remaining: this.memory.length
        });
    }

    /**
     * Retorna estatísticas da memória.
     */
    stats(): { entries: number; byType: Record<string, number> } {
        const byType: Record<string, number> = {};
        
        for (const entry of this.memory) {
            byType[entry.type] = (byType[entry.type] || 0) + 1;
        }

        return {
            entries: this.memory.length,
            byType
        };
    }

    /**
     * Limpa a memória (útil para testes).
     */
    clear(): void {
        this.memory = [];
        this.logger.info('memory_clear', 'Memória de classificação limpa');
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