// ── Intent Detection Registry ─────────────────────────────────────────────
// Detectores de intenção registráveis. Cada detector retorna IntentResult
// com tipo + confiança, ou null se não reconheceu a entrada.

export interface IntentResult {
    type: string;          // ex: 'continue', 'stop', 'cancel', 'execute'
    confidence: number;    // 0.0 – 1.0
    raw: string;           // entrada original
}

type IntentDetectorFn = (text: string) => IntentResult | null;

// ── Detectores individuais ────────────────────────────────────────────────

function detectContinue(text: string): IntentResult | null {
    const isShort = text.length < 60;
    const hasQuestion = text.includes('?');

    const STRONG = /^(so continue|continue|continuar|continue o projeto|segue o projeto|prossiga|prosseguir|nao recrie|não recrie|nao crie novo|não crie novo|vai la|bora|vamos)\b/;
    if (STRONG.test(text) && isShort && !hasQuestion) {
        return { type: 'continue', confidence: 0.95, raw: text };
    }

    // Menção no meio da frase, sem ?
    if (/\b(continuar|continue|prosseguir|prossiga)\b/.test(text) && !hasQuestion) {
        const conf = isShort ? 0.55 : 0.35;
        return { type: 'continue', confidence: conf, raw: text };
    }

    return null;
}

function detectStop(text: string): IntentResult | null {
    const isShort = text.length < 60;
    const hasQuestion = text.includes('?');

    const STRONG = /^(parar|pare|cancelar|cancele|abortar|aborte|desistir|desisto|chega|para tudo)\b/;
    if (STRONG.test(text) && isShort && !hasQuestion) {
        return { type: 'stop', confidence: 0.95, raw: text };
    }

    if (/\b(parar|cancelar|abortar|desistir)\b/.test(text) && !hasQuestion) {
        const conf = isShort ? 0.5 : 0.3;
        return { type: 'stop', confidence: conf, raw: text };
    }

    return null;
}

function detectExecute(text: string): IntentResult | null {
    const isShort = text.length < 60;
    const hasQuestion = text.includes('?');

    const STRONG = /^(executa|executar|rodar|roda|faz|faca|faça|aplica|aplicar|manda ver|manda bala)\b/;
    if (STRONG.test(text) && isShort && !hasQuestion) {
        return { type: 'execute', confidence: 0.9, raw: text };
    }

    return null;
}

// ── Registry ──────────────────────────────────────────────────────────────

const INTENT_REGISTRY: IntentDetectorFn[] = [
    detectContinue,
    detectStop,
    detectExecute,
];

/**
 * Roda todos os detectores e retorna o de maior confiança,
 * ou null se nenhum reconheceu a entrada.
 */
export function detectIntent(text: string): IntentResult | null {
    const normalized = text.toLowerCase().trim();
    let best: IntentResult | null = null;

    for (const detect of INTENT_REGISTRY) {
        const result = detect(normalized);
        if (result && (!best || result.confidence > best.confidence)) {
            best = result;
        }
    }

    return best;
}
