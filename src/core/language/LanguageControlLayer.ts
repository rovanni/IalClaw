/**
 * Language Control Layer (LCL)
 * 
 * Centraliza o controle de idioma do agente.
 * Responsabilidades:
 *   1. Detectar o idioma do input do usuário (determinístico, sem LLM)
 *   2. Persistir o idioma na sessão com threshold anti-flip-flop
 *   3. Gerar diretiva de idioma para injeção no system prompt
 * 
 * Prioridade de resolução: input > session > default ('pt-BR')
 */

import { detectLanguage } from '../../i18n';
import { Lang } from '../../i18n/types';
import { createLogger } from '../../shared/AppLogger';

const logger = createLogger('LanguageControlLayer');

/** Inputs curtos/ambíguos que NÃO devem alterar o idioma da sessão */
const SHORT_INPUT_WHITELIST = new Set([
    'ok', 'yes', 'no', 'sim', 'não', 'nao',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    'certo', 'errado', 'confirmo', 'cancela', 'cancelar',
    'confirmar', 'prosseguir', 'continuar', 'voltar',
    'sure', 'nope', 'yep', 'yeah', 'nah', 'cancel', 'confirm',
    'next', 'back', 'done', 'retry', 'skip'
]);

/** Número mínimo de palavras para considerar detecção confiável */
const MIN_WORDS_FOR_DETECTION = 3;

/** Labels human-readable por idioma */
const LANGUAGE_LABELS: Record<Lang, string> = {
    'pt-BR': 'Português (Brasil)',
    'en-US': 'English'
};

/** Nomes nativos dos idiomas (usados na diretiva) */
const LANGUAGE_NAMES: Record<Lang, string> = {
    'pt-BR': 'Português',
    'en-US': 'English'
};

export interface LanguageResolution {
    /** Idioma resolvido final */
    lang: Lang;
    /** Se o idioma foi detectado do input (vs. herdado da sessão) */
    detectedFromInput: boolean;
    /** Confiança da detecção (0-1). 0 se herdado da sessão */
    confidence: number;
}

export interface SessionLike {
    language?: Lang;
}

/**
 * Resolve o idioma para a interação atual.
 * 
 * Prioridade: input > session > default
 * Com proteção anti-flip-flop para inputs curtos/ambíguos.
 */
export function resolveLanguage(input: string, session?: SessionLike | null): LanguageResolution {
    const trimmed = input.trim();
    const normalized = trimmed.toLowerCase();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

    // ── Guard: inputs curtos/confirmações NÃO alteram idioma ────────────
    if (SHORT_INPUT_WHITELIST.has(normalized) || wordCount < MIN_WORDS_FOR_DETECTION) {
        const lang = session?.language ?? 'pt-BR';
        logger.info('language_short_input_preserved', '[LCL] Input curto/ambíguo — idioma preservado', {
            input: trimmed.slice(0, 30),
            preserved_lang: lang
        });
        return { lang, detectedFromInput: false, confidence: 0 };
    }

    // ── Detecção a partir do input (100% determinística) ────────────────
    const detected = detectLanguage(input);

    if (detected) {
        // Calcular confiança baseada em quantidade de palavras e clareza
        const confidence = Math.min(1.0, wordCount / 8);

        // Persistir na sessão se confiança suficiente
        if (session && confidence >= 0.3) {
            const previousLang = session.language;
            session.language = detected;

            if (previousLang && previousLang !== detected) {
                logger.info('language_persisted', '[LCL] Idioma da sessão atualizado', {
                    previous: previousLang,
                    new: detected,
                    confidence: confidence.toFixed(2)
                });
            }
        }

        logger.info('language_detected', '[LCL] Idioma detectado do input', {
            detected,
            confidence: confidence.toFixed(2),
            word_count: wordCount
        });

        return { lang: detected, detectedFromInput: true, confidence };
    }

    // ── Fallback: sessão ou default ────────────────────────────────────
    const lang = session?.language ?? 'pt-BR';
    return { lang, detectedFromInput: false, confidence: 0 };
}

/**
 * Gera a diretiva de idioma para injeção no system prompt.
 * 
 * Posição recomendada no prompt:
 *   [IDENTIDADE] → [REGRAS COGNITIVAS] → [LANGUAGE DIRECTIVE] → [CONTEXTO]
 */
export function buildLanguageDirective(lang: Lang): string {
    const langName = LANGUAGE_NAMES[lang];

    if (lang === 'pt-BR') {
        return (
            `\n\nDIRETIVA DE IDIOMA:` +
            `\nVocê DEVE responder em ${langName}.` +
            `\nTodas as respostas, explicações e mensagens devem ser em ${langName}.` +
            `\nNÃO troque de idioma a menos que o usuário solicite explicitamente.`
        );
    }

    return (
        `\n\nLANGUAGE DIRECTIVE:` +
        `\nYou MUST respond in ${langName}.` +
        `\nAll responses, explanations, and messages must be in ${langName}.` +
        `\nDo NOT switch to another language unless the user explicitly requests it.`
    );
}

/**
 * Retorna o label human-readable do idioma.
 */
export function getLanguageLabel(lang: Lang): string {
    return LANGUAGE_LABELS[lang] ?? lang;
}
