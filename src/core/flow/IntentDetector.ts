import { IntentType } from './types';

export class IntentDetector {
    private static readonly ESCAPE_KEYWORDS = ["cancel", "stop", "exit", "sair", "cancelar", "parar", "esquece", "deixa pra lá"];

    /**
     * Detects user intent from input string.
     */
    public static detect(input: string): IntentType {
        const normalized = input.toLowerCase().trim();

        // Check for meta-questions (why, how, what did you do)
        if (this.isMeta(normalized)) {
            return 'META';
        }

        // Check for questions
        if (normalized.includes('?') || /^(o que|como|qual|quais|quem|onde|quando|por que|porque|você|voce|podia|poderia|seria)\b/i.test(normalized)) {
            return 'QUESTION';
        }

        // Check for escape keywords as a form of non-task intent during a flow
        if (this.isEscape(normalized)) {
            return 'META'; // Or a specific EXIT intent if preferred
        }

        // Check for task/imperative intent
        if (this.isTask(normalized)) {
            return 'TASK';
        }

        return 'UNKNOWN';
    }

    public static isEscape(input: string): boolean {
        const normalized = input.toLowerCase().trim();
        return this.ESCAPE_KEYWORDS.some(k => normalized.includes(k));
    }

    private static isMeta(normalized: string): boolean {
        const metaPatterns = [
            /\b(você|voce|tu|sua|seu)\b.*\b(utilizou|usou|fez|criou|conseguiu|pode|consegue|saberia)\b/i,
            /\bcomo\b.*\b(consegue|funciona|opera|faz|conseguiu)\b/i,
            /\b(qual|o que|quem)\b.*\b(é|es|sois|voce|você)\b/i,
            /\b(você|voce)\b.*\b(conhece|sabe|entende)\b/i,
            /\bpor\s+que\b/i,
            /\bwhy\b/i,
            /\bexplic\w+\b/i
        ];
        return metaPatterns.some(pattern => pattern.test(normalized));
    }

    private static isTask(normalized: string): boolean {
        // High confidence task indicators
        const taskIndicators = [
            /\b(crie|gere|faça|faca|monte|redija|elabora|escreva|execute|rode|verifique)\b/i,
            /\b(write|create|generate|run|execute|check)\b/i,
            // Numbers or direct options often used in flows
            /^\d+$/,
            /^(sim|não|nao|yes|no)$/i
        ];
        return taskIndicators.some(pattern => pattern.test(normalized));
    }
}
