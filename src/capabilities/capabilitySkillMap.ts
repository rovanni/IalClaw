import { canonicalizeCapability } from './canonicalizeCapability';

export const CAPABILITY_TO_SKILLS: Record<string, string[]> = {
    audio_response: ['telegram-voice', 'tts', 'ffmpeg'],
    speech_to_text: ['telegram-voice', 'whisper', 'ffmpeg'],
    web_search: ['web-search', 'browser-automation', 'browser'],
    file_read: ['file-manipulator', 'pdf-extraction', 'builtin_fs'],
    file_write: ['file-manipulator', 'builtin_fs'],
    document_generate: ['docx', 'pdf', 'pptx', 'xlsx'],
    image_generate: ['image-generation'],
    system_setup: ['system-provisioner', 'setup-system-permissions', 'sudo_permissions'],
    automation: ['browser-automation', 'calendar-automation', 'webapp-testing', 'node_runtime']
};

export const CAPABILITY_PRIORITY: Record<string, string[]> = {
    audio_response: ['telegram-voice', 'tts', 'ffmpeg'],
    speech_to_text: ['telegram-voice', 'whisper', 'ffmpeg'],
    web_search: ['web-search', 'browser-automation', 'browser'],
    system_setup: ['system-provisioner', 'setup-system-permissions', 'sudo_permissions']
};

const CAPABILITY_TO_RUNTIME_REQUIREMENTS: Record<string, string[]> = {
    audio_response: ['tts_generation', 'ffmpeg'],
    speech_to_text: ['whisper_transcription', 'ffmpeg'],
    web_search: ['browser_execution'],
    file_read: ['fs_access'],
    file_write: ['fs_access'],
    document_generate: ['fs_access'],
    image_generate: ['fs_access'],
    system_setup: ['sudo_permissions'],
    automation: ['node_execution']
};

export function normalizeCapability(capability: string): string | undefined {
    const canonicalized = canonicalizeCapability(capability);
    return canonicalized.isKnown ? canonicalized.canonical : undefined;
}

export function getCandidateSkillsForCapability(capability: string): string[] {
    const normalized = normalizeCapability(capability);
    if (!normalized) {
        return [];
    }

    return CAPABILITY_TO_SKILLS[normalized] || [];
}

export function getRuntimeRequirementsForCapability(capability: string): string[] {
    const normalized = normalizeCapability(capability);
    if (!normalized) {
        return [];
    }

    return CAPABILITY_TO_RUNTIME_REQUIREMENTS[normalized] || [normalized];
}

export function deriveCapabilitiesFromInput(input: string): string[] {
    const text = (input || '').toLowerCase();
    const caps = new Set<string>();

    if (/áudio|audio|voz|voice|tts/.test(text)) {
        caps.add('audio_response');
    }

    if (/transcri|transcript|stt|speech to text|whisper/.test(text)) {
        caps.add('speech_to_text');
    }

    if (/buscar na web|web search|pesquisar|google|navegador|browser/.test(text)) {
        caps.add('web_search');
    }

    if (/instalar|setup|configurar|permiss|sudo|provision/.test(text)) {
        caps.add('system_setup');
    }

    return Array.from(caps);
}
