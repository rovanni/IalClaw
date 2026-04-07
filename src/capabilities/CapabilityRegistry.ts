export type Capability =
    | 'browser_execution'
    | 'fs_access'
    | 'node_execution'
    | 'git'
    | 'docker'
    | 'test_runner'
    | 'whisper_transcription'
    | 'tts_generation'
    | 'ffmpeg'
    | 'sudo_permissions';

export const CANONICAL_CAPABILITIES = {
    audio_response: {
        description: 'Resposta de audio ao usuario',
        category: 'communication'
    },
    speech_to_text: {
        description: 'Transcricao de voz para texto',
        category: 'communication'
    },
    web_search: {
        description: 'Busca e leitura de conteudo na web',
        category: 'research'
    },
    file_read: {
        description: 'Leitura de arquivos locais',
        category: 'workspace'
    },
    file_write: {
        description: 'Escrita e atualizacao de arquivos locais',
        category: 'workspace'
    },
    document_generate: {
        description: 'Geracao de documentos estruturados',
        category: 'content'
    },
    image_generate: {
        description: 'Geracao de imagens e assets',
        category: 'content'
    },
    system_setup: {
        description: 'Configuracao de ambiente e permissoes',
        category: 'system'
    },
    automation: {
        description: 'Automacao de tarefas recorrentes',
        category: 'automation'
    },
    browser_execution: {
        description: 'Execucao e automacao em navegador',
        category: 'runtime'
    },
    fs_access: {
        description: 'Acesso ao sistema de arquivos',
        category: 'runtime'
    },
    node_execution: {
        description: 'Execucao de comandos Node.js',
        category: 'runtime'
    },
    git: {
        description: 'Operacoes Git no repositorio',
        category: 'runtime'
    },
    docker: {
        description: 'Operacoes de conteinerizacao com Docker',
        category: 'runtime'
    },
    test_runner: {
        description: 'Execucao de suites de teste',
        category: 'runtime'
    },
    whisper_transcription: {
        description: 'Transcricao por Whisper',
        category: 'runtime'
    },
    tts_generation: {
        description: 'Geracao de audio via TTS',
        category: 'runtime'
    },
    ffmpeg: {
        description: 'Processamento de audio e video',
        category: 'runtime'
    },
    sudo_permissions: {
        description: 'Permissoes elevadas para setup',
        category: 'runtime'
    }
} as const;

export type CanonicalCapability = keyof typeof CANONICAL_CAPABILITIES;

export function isCanonicalCapability(value: string): value is CanonicalCapability {
    return Object.prototype.hasOwnProperty.call(CANONICAL_CAPABILITIES, value);
}

export function listCanonicalCapabilities(): CanonicalCapability[] {
    return Object.keys(CANONICAL_CAPABILITIES) as CanonicalCapability[];
}

export interface CapabilityState {
    available: boolean;
    source?: string;
    checkedAt: number;
}

export class CapabilityRegistry {
    private capabilities = new Map<Capability, CapabilityState>();

    set(capability: Capability, state: CapabilityState) {
        this.capabilities.set(capability, state);
    }

    get(capability: Capability): CapabilityState | undefined {
        return this.capabilities.get(capability);
    }

    isAvailable(capability: Capability): boolean {
        return this.capabilities.get(capability)?.available === true;
    }

    snapshot(): Record<string, CapabilityState> {
        return Object.fromEntries(this.capabilities.entries());
    }
}
