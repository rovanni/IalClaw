import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { AgentContext, Lang, TranslationCatalog, TranslationDictionary, TranslationParams } from './types';

const SUPPORTED_LANGS: Lang[] = ['pt-BR', 'en-US'];
const DEFAULT_LANG: Lang = 'pt-BR';
const languageScope = new AsyncLocalStorage<Lang>();

let globalLanguage: Lang = DEFAULT_LANG;

function loadJsonDictionary(fileName: string): TranslationDictionary {
    const filePath = path.join(__dirname, fileName);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as TranslationDictionary;
}

const catalog: TranslationCatalog = {
    'pt-BR': loadJsonDictionary('pt-BR.json'),
    'en-US': loadJsonDictionary('en-US.json')
};

function normalizeLang(lang?: string | null): Lang {
    if (!lang) return DEFAULT_LANG;
    const lower = lang.toLowerCase();
    if (lower === 'pt-br' || lower === 'pt') return 'pt-BR';
    if (lower === 'en-us' || lower === 'en') return 'en-US';
    return DEFAULT_LANG;
}

export function getSupportedLanguages(): Lang[] {
    return [...SUPPORTED_LANGS];
}

export function setLanguage(lang: Lang): void {
    globalLanguage = normalizeLang(lang);
}

export function getLanguage(context?: Partial<AgentContext>): Lang {
    if (context?.language) {
        return normalizeLang(context.language);
    }
    return languageScope.getStore() || globalLanguage;
}

export function withLanguage<T>(lang: Lang, run: () => T): T {
    const normalized = normalizeLang(lang);
    return languageScope.run(normalized, run);
}

export function t(key: string, params?: TranslationParams, context?: Partial<AgentContext>): string {
    const lang = getLanguage(context);
    const langDict = catalog[lang] || {};
    const defaultDict = catalog[DEFAULT_LANG] || {};
    const template = langDict[key] ?? defaultDict[key];

    if (!template) {
        return key;
    }

    return interpolate(template, params);
}

function interpolate(template: string, params?: TranslationParams): string {
    if (!params) return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => {
        const value = params[name];
        return value === undefined || value === null ? `{${name}}` : String(value);
    });
}

export function detectLanguage(text: string): Lang | null {
    const normalized = String(text || '').toLowerCase();
    if (!normalized.trim()) return null;

    if (/\b(lang|language)\s*[:=]?\s*(en|en-us|english)\b/.test(normalized)) return 'en-US';
    if (/\b(idioma|lingua|língua)\s*[:=]?\s*(pt|pt-br|português|portugues)\b/.test(normalized)) return 'pt-BR';
    if (/\b(speak english|answer in english|respond in english)\b/.test(normalized)) return 'en-US';
    if (/\b(fale em portugu[eê]s|responda em portugu[eê]s)\b/.test(normalized)) return 'pt-BR';

    const enHints = ['the ', 'please', 'could you', 'would you', 'thanks', 'memory', 'project', 'error'];
    const ptHints = [' você', ' por favor', 'memória', 'projeto', 'erro', 'obrigado', 'responda'];

    let enScore = 0;
    let ptScore = 0;

    for (const hint of enHints) {
        if (normalized.includes(hint)) enScore++;
    }
    for (const hint of ptHints) {
        if (normalized.includes(hint)) ptScore++;
    }

    if (enScore === ptScore) return null;
    return enScore > ptScore ? 'en-US' : 'pt-BR';
}
