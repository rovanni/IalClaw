import { t } from '../../../i18n';

const FALLBACK_PATTERNS = [
    /\b(crie|criar|gere|gerar|fa(ca|ça)|fazer)\b/i,
    /\b(execute|run|create|generate|build)\b/i,
    /\b(instale|instalar|adicione|adicionar)\b/i,
    /\b(converta|converter|transforme|transformar)\b/i,
    /\b(monte|escreva|redija)\b/i
];

export function isExecution(input: string): boolean {
    const normalized = normalizeIntentInput(input);
    const translatedPattern = buildTranslatedPattern('intent.execution.regex');

    if (translatedPattern?.test(normalized)) {
        return true;
    }

    return FALLBACK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildTranslatedPattern(key: string): RegExp | null {
    const pattern = t(key);
    if (!pattern || pattern === key) {
        return null;
    }

    try {
        return new RegExp(pattern, 'i');
    } catch {
        return null;
    }
}

function normalizeIntentInput(input: string): string {
    return String(input || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .trim();
}