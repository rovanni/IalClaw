import fs from 'fs';
import path from 'path';
import { Lang } from '../i18n/types';

export const LANGUAGE_CONFIG_FILE = 'config.json';
export const LANGUAGE_FALLBACK: Lang = 'en-US';

export type AppConfig = {
    language?: string;
    [key: string]: unknown;
};

export function normalizeLanguage(input?: string | null): Lang {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'pt' || value === 'pt-br') return 'pt-BR';
    if (value === 'en' || value === 'en-us') return 'en-US';
    return LANGUAGE_FALLBACK;
}

export function getProjectRoot(): string {
    return path.resolve(__dirname, '..', '..');
}

export function getConfigPath(projectRoot: string = getProjectRoot()): string {
    return path.join(projectRoot, LANGUAGE_CONFIG_FILE);
}

export function readAppConfig(projectRoot: string = getProjectRoot()): AppConfig {
    const configPath = getConfigPath(projectRoot);
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as AppConfig : {};
    } catch {
        return {};
    }
}

export function writeAppConfig(config: AppConfig, projectRoot: string = getProjectRoot()): void {
    const configPath = getConfigPath(projectRoot);
    const content = `${JSON.stringify(config, null, 2)}\n`;
    fs.writeFileSync(configPath, content, 'utf8');
}

export function getConfiguredLanguage(projectRoot: string = getProjectRoot()): Lang | null {
    const config = readAppConfig(projectRoot);
    if (!config.language || typeof config.language !== 'string') {
        return null;
    }

    return normalizeLanguage(config.language);
}

export function resolveAppLanguage(projectRoot: string = getProjectRoot()): Lang {
    const envLang = process.env.APP_LANG;
    if (envLang) {
        return normalizeLanguage(envLang);
    }

    const configLang = getConfiguredLanguage(projectRoot);
    if (configLang) {
        return configLang;
    }

    return LANGUAGE_FALLBACK;
}

export function setConfiguredLanguage(lang: string, projectRoot: string = getProjectRoot()): Lang {
    const normalized = normalizeLanguage(lang);
    const config = readAppConfig(projectRoot);
    config.language = normalized;
    writeAppConfig(config, projectRoot);
    return normalized;
}
