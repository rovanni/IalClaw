export type Lang = 'pt-BR' | 'en-US';

export type TranslationDictionary = Record<string, string>;

export type TranslationCatalog = Record<Lang, TranslationDictionary>;

export type TranslationParams = Record<string, unknown>;

export interface AgentContext {
    language: Lang;
}
