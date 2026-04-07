const CAPABILITY_ALIASES: Record<string, string> = {
    audio: 'audio_response',
    audio_response: 'audio_response',
    voice: 'audio_response',
    voice_response: 'audio_response',
    tts: 'audio_response',
    tts_generation: 'audio_response',

    stt: 'speech_to_text',
    speech_to_text: 'speech_to_text',
    voice_input: 'speech_to_text',
    whisper: 'speech_to_text',
    whisper_transcription: 'speech_to_text',

    web_search: 'web_search',
    search_web: 'web_search',
    browser_search: 'web_search',

    file_read: 'file_read',
    file_write: 'file_write',
    document_generate: 'document_generate',
    image_generate: 'image_generate',
    system_setup: 'system_setup',
    automation: 'automation',

    browser_execution: 'browser_execution',
    fs_access: 'fs_access',
    node_execution: 'node_execution',
    git: 'git',
    docker: 'docker',
    ffmpeg: 'ffmpeg',
    test_runner: 'test_runner',
    sudo_permissions: 'sudo_permissions'
};

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
    const key = (capability || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return CAPABILITY_ALIASES[key];
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
