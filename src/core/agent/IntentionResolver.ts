import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';

export type IntentType = 'CONTINUE' | 'STOP' | 'EXECUTE' | 'CONFIRM' | 'DECLINE' | 'RETRY' | 'QUESTION' | 'META' | 'TASK' | 'MEMORY_QUERY' | 'MEMORY_CHECK' | 'MEMORY_STORE' | 'UNKNOWN';

export interface IntentMatch {
    type: IntentType;
    confidence: number;
}

/**
 * IntentionResolver: Centraliza a detecção de intenção baseada em heurísticas e regex.
 * Unifica a lógica que antes estava duplicada entre core/agent e core/flow.
 */
export class IntentionResolver {
    private static logger = createLogger('IntentionResolver');

    /**
     * Resolve a intenção do usuário baseada no texto e contexto opcional.
     */
    public static resolve(text: string): IntentMatch {
        const normalized = text.toLowerCase().trim();
        const isShort = normalized.length < 80;
        const hasQuestionMark = normalized.includes('?');

        // 1. CONFIRM / DECLINE / RETRY (Alta prioridade para loops de confirmação)
        if (this.matchPattern(normalized, 'intent.confirm.strong')) return { type: 'CONFIRM', confidence: 0.95 };
        if (this.matchPattern(normalized, 'intent.confirm.permissive')) return { type: 'CONFIRM', confidence: 0.85 };
        if (this.matchPattern(normalized, 'intent.decline.regex')) return { type: 'DECLINE', confidence: 0.95 };
        if (this.matchPattern(normalized, 'intent.retry.regex')) return { type: 'RETRY', confidence: 0.95 };
        
        // 1.5. MEMORY INTROSPECTION (GATING + REGEX)
        if (this.isMemoryIntrospection(normalized)) {
            // MEMORY_STORE: "guarde isso", "lembre disso", "registre isso"
            const isStore = /\b(guard\w+|armaz\w+|registr\w+|anot\w+|salv\w+)\b/i.test(normalized) && 
                            !hasQuestionMark && 
                            /\b(isso|isto|esta|essa|aquele|aquela|tudo|contexto|que|o\s+fato)\b/i.test(normalized);
            
            if (isStore) return { type: 'MEMORY_STORE', confidence: 0.94 };

            // MEMORY_CHECK: "esta na memoria?", "foi registrado?", "voce lembra?"
            const hasOpenIndicator = /^(o que|quais|como|quem|me diga|mostre)\b/i.test(normalized);
            const isCheck = /(?:^|\s|["'])(esta|está|tem|foi|const\w*|registr\w+|armazen\w+|guard\w+|salv\w+|grav\w+|lembr\w+|record\w+)(?:\s|$|[?,.!;: "'])/i.test(normalized) && 
                            (hasQuestionMark || normalized.length < 30 || /^(você|voce|vce|tu)\b/i.test(normalized)) &&
                            !hasOpenIndicator;
                            
            return { type: isCheck ? 'MEMORY_CHECK' : 'MEMORY_QUERY', confidence: 0.92 };
        }

        // 2. STOP / CANCEL
        const STOP_KEYWORDS = ["cancel", "stop", "exit", "sair", "cancelar", "parar", "esquece", "deixa pra lá", "para tudo", "aborte", "abortar"];
        if (STOP_KEYWORDS.some(k => normalized.startsWith(k)) && isShort) {
            return { type: 'STOP', confidence: 0.95 };
        }

        // 3. META / QUESTION
        if (this.isMeta(normalized)) {
            return { type: 'META', confidence: 0.9 };
        }

        if (hasQuestionMark || /^(o que|como|qual|quais|quem|onde|quando|por que|porque|você|voce|podia|poderia|seria|que|pode|quer)\b/i.test(normalized)) {
            return { type: 'QUESTION', confidence: 0.85 };
        }

        // 4. CONTINUE / EXECUTE
        const CONTINUE_KEYWORDS = ["continue", "continuar", "prossiga", "prosseguir", "vai la", "bora", "vamos", "segue"];
        if (CONTINUE_KEYWORDS.some(k => normalized.startsWith(k)) && isShort && !hasQuestionMark) {
            return { type: 'CONTINUE', confidence: 0.9 };
        }

        const EXECUTE_KEYWORDS = ["executa", "executar", "rodar", "roda", "faz", "faca", "faça", "aplica", "aplicar", "manda ver"];
        if (EXECUTE_KEYWORDS.some(k => normalized.startsWith(k)) && isShort && !hasQuestionMark) {
            return { type: 'EXECUTE', confidence: 0.85 };
        }

        // 5. TASK (Imperativos genéricos)
        if (this.isTaskIndicator(normalized)) {
            return { type: 'TASK', confidence: 0.7 };
        }

        return { type: 'UNKNOWN', confidence: 0.0 };
    }

    /**
     * Verifica se o input está relacionado ao tópico atual (utilizado para evitar escapes acidentais de flow).
     */
    public static isIntentRelatedToTopic(input: string, topic?: string): boolean {
        if (!topic) return false;
        const normalizedInput = input.toLowerCase();
        const normalizedTopic = topic.toLowerCase();

        // Verifica se o tópico é mencionado ou se o input é muito curto (resposta direta a step do flow)
        return normalizedInput.includes(normalizedTopic) || normalizedInput.length < 20;
    }

    private static matchPattern(text: string, i18nKey: string): boolean {
        try {
            const pattern = t(i18nKey);
            if (!pattern || pattern === i18nKey) return false;
            const regex = new RegExp(pattern, 'i');
            return regex.test(text);
        } catch (e) {
            (this as any).logger.error('regex_error', `Falha ao testar padrão ${i18nKey}`, { error: String(e) });
            return false;
        }
    }

    private static isMeta(normalized: string): boolean {
        const metaPatterns = [
            /\b(você|voce|tu|sua|seu)\b.*\b(utilizou|usou|fez|criou|conseguiu|pode|consegue|saberia)\b/i,
            /\bcomo\b.*\b(consegue|funciona|opera|faz|conseguiu)\b/i,
            /\b(qual|o que|quem)\b.*\b(é|es|sois|voce|você)\b/i,
            /\b(você|voce)\b.*\b(conhece|sabe|entende)\b/i,
            /\b(por\s+que|why|explic\w+)\b/i
        ];
        return metaPatterns.some(pattern => pattern.test(normalized));
    }

    private static isTaskIndicator(normalized: string): boolean {
        const taskIndicators = [
            /\b(crie|gere|faça|faca|monte|redija|elabora|escreva|execute|rode|verifique)\b/i,
            /\b(write|create|generate|run|execute|check)\b/i,
            /^\d+$/,
            /^(sim|não|nao|yes|no)$/i
        ];
        return taskIndicators.some(pattern => pattern.test(normalized));
    }

    private static isMemoryIntrospection(normalized: string): boolean {
        const keywords = /(lembr\w+|memória|memoria|regist\w+|armazen\w+|guard\w+|sabe|conhece|anot\w+|record\w+|grav\w+)/i;
        const context = /(você|voce|vce|tu|mim|meu|minha|minhas|meus|nosso|nossa|seu|sua|disso|disto|daqui|desse|dessa|daquele|daquela|comigo|isso|isto|esta|está|foi|registrado)/i;
        
        const hasKeywords = keywords.test(normalized);
        const hasContext = context.test(normalized);
        
        const isStrict = hasKeywords && hasContext;
        const isShort = normalized.length < 150; 
        
        return isStrict && isShort;
    }
}
