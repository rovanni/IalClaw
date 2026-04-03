import { t } from '../../../i18n';

const FALLBACK_PATTERNS = [
    /\b(converta|converter|convert|transforme|transformar)\b.*\b(arquivo|file|pdf|docx|pptx|md|html|txt|json)\b/i,
    /\b(arquivo|file)\b.*\b(converta|converter|convert|transforme|transformar)\b/i,
    /\b(md|html|pdf|docx|pptx|txt|json)\b\s*(para|to)\s*\b(md|html|pdf|docx|pptx|txt|json)\b/i
];

export function isConversion(input: string): boolean {
    const normalized = normalizeIntentInput(input);
    const translatedPattern = buildTranslatedPattern('intent.conversion.regex');

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