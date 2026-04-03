import { t } from '../../../i18n';

const FALLBACK_PATTERNS = [
    /\b(me ajude|me ajuda|help me)\b/i,
    /\b(estou pensando|i am thinking|thinking about)\b/i,
    /\b(tenho uma ideia|i have an idea)\b/i,
    /\b(como posso|how can i)\b/i,
    /\b(quero fazer|i want to do)\b/i,
    /\b(quero criar|i want to create)\b/i,
    /\b(vamos pensar|let'?s think)\b/i,
    /\b(poderia me orientar|could you guide me)\b/i
];

export function isExploration(input: string): boolean {
    const normalized = normalizeIntentInput(input);
    const translatedPattern = buildTranslatedPattern('intent.exploration.regex');

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