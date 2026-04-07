import { CanonicalCapability, isCanonicalCapability } from './CapabilityRegistry';

const CAPABILITY_ALIAS_ENTRIES: Array<readonly [string, CanonicalCapability]> = [
    ['audio', 'audio_response'],
    ['audio_response', 'audio_response'],
    ['voice', 'audio_response'],
    ['voice_response', 'audio_response'],
    ['tts', 'audio_response'],
    ['stt', 'speech_to_text'],
    ['speech_to_text', 'speech_to_text'],
    ['voice_input', 'speech_to_text'],
    ['whisper', 'speech_to_text'],
    ['whisper_transcription', 'whisper_transcription'],
    ['web_search', 'web_search'],
    ['search_web', 'web_search'],
    ['browser_search', 'web_search'],
    ['browser_nav', 'browser_execution'],
    ['browser_navigation', 'browser_execution'],
    ['file_read', 'file_read'],
    ['file_write', 'file_write'],
    ['document_generate', 'document_generate'],
    ['image_generate', 'image_generate'],
    ['system_setup', 'system_setup'],
    ['automation', 'automation'],
    ['browser_execution', 'browser_execution'],
    ['fs_access', 'fs_access'],
    ['node_execution', 'node_execution'],
    ['git', 'git'],
    ['docker', 'docker'],
    ['ffmpeg', 'ffmpeg'],
    ['test_runner', 'test_runner'],
    ['sudo_permissions', 'sudo_permissions'],
    ['tts_generation', 'tts_generation']
];

export const CAPABILITY_ALIASES: Readonly<Record<string, CanonicalCapability>> = Object.freeze(
    Object.fromEntries(CAPABILITY_ALIAS_ENTRIES)
);

export function validateAliasMap(): void {
    const seen = new Map<string, CanonicalCapability>();

    for (const [alias, canonical] of CAPABILITY_ALIAS_ENTRIES) {
        if (!isCanonicalCapability(canonical)) {
            throw new Error(`[KB-050] Alias aponta para capability invalida: ${alias} -> ${canonical}`);
        }

        const existing = seen.get(alias);
        if (existing && existing !== canonical) {
            throw new Error(`[KB-050] Alias conflitante detectado: ${alias} -> ${existing} e ${canonical}`);
        }

        seen.set(alias, canonical);
    }
}
