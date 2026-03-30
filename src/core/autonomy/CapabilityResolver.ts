import { createLogger } from '../../shared/AppLogger';
import { TaskType } from '../agent/TaskClassifier';
import { TaskNature } from './ActionRouter';
import * as shutil from 'fs'; // Dummy for interface, will use real check in adapter
import { execSync } from 'child_process';

export enum CapabilityStatus {
    AVAILABLE = 'available',
    MISSING = 'missing',
    OPTIONAL = 'optional'
}

export interface CapabilityGap {
    resource: string;
    reason: string;
    task: string;
    severity: 'blocking' | 'enhancement';
}

export interface ResolutionProposal {
    hasGap: boolean;
    gap?: CapabilityGap;
    status: CapabilityStatus;
    solution?: {
        type: 'install' | 'alternative' | 'manual';
        tool: string;
        command?: string;
        alternatives?: string[];
        requiresConfirmation: boolean;
    };
}

/**
 * ProvisionerAdapter: Abstração para detecção e sugestão de ferramentas.
 * Evita acoplamento direto com as skills no core.
 */
export interface ProvisionerAdapter {
    isInstalled(tool: string): boolean;
    resolveSolution(tool: string): ResolutionProposal['solution'];
}

/**
 * DefaultProvisionerAdapter: Implementação básica usando comandos de sistema.
 */
class DefaultProvisionerAdapter implements ProvisionerAdapter {
    isInstalled(tool: string): boolean {
        try {
            const cmd = process.platform === 'win32' ? `where ${tool}` : `which ${tool}`;
            execSync(cmd, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    resolveSolution(tool: string): ResolutionProposal['solution'] {
        const os = process.platform === 'win32' ? 'Windows' : 'Linux';
        // Heurística básica de comandos
        const commands: Record<string, string> = {
            'ffmpeg': os === 'Windows' ? 'choco install ffmpeg' : 'sudo apt install ffmpeg',
            'git': os === 'Windows' ? 'winget install Git.Git' : 'sudo apt install git',
            'tree': os === 'Windows' ? 'choco install tree' : 'sudo apt install tree'
        };

        return {
            type: 'install',
            tool: tool,
            command: commands[tool.toLowerCase()],
            requiresConfirmation: true
        };
    }
}

/**
 * CapabilityResolver: Formaliza a "Cognitive Capability Gap Resolution Layer".
 * Detecta lacunas entre a intenção do usuário e as capacidades instaladas do sistema.
 */
export class CapabilityResolver {
    private logger = createLogger('CapabilityResolver');
    private adapter: ProvisionerAdapter = new DefaultProvisionerAdapter();

    private readonly TASK_TOOL_MAP: Record<string, string[]> = {
        'video_conversion': ['ffmpeg'],
        'audio_processing': ['ffmpeg'],
        'visualization': ['tree'],
        'vcs': ['git'],
        'automation': ['python', 'node']
    };

    /**
     * Resolve lacunas de capacidade baseadas na natureza da tarefa.
     */
    public resolve(input: string, taskType: TaskType | null, nature: TaskNature): ResolutionProposal {
        const text = input.toLowerCase();

        // 1. REGRA ANTI-REGRESSÃO: Ignorar tarefas puramente informativas
        if (nature === TaskNature.INFORMATIVE) {
            this.logger.debug('capability_resolver_skip', 'Ignorando resolução para tarefa informativa');
            return { hasGap: false, status: CapabilityStatus.AVAILABLE };
        }

        const category = this.detectTaskCategory(text, taskType);
        if (!category) {
            return { hasGap: false, status: CapabilityStatus.AVAILABLE };
        }

        const requiredTools = this.TASK_TOOL_MAP[category] || [];

        for (const tool of requiredTools) {
            if (this.isToolRequired(text, tool)) {
                if (!this.adapter.isInstalled(tool)) {
                    this.logger.info('capability_gap_detected', `Lacuna detectada: ${tool} para tarefa ${category}`);
                    return {
                        hasGap: true,
                        status: CapabilityStatus.MISSING,
                        gap: {
                            resource: tool,
                            reason: category,
                            task: category,
                            severity: 'blocking'
                        },
                        solution: this.adapter.resolveSolution(tool)
                    };
                }
            }
        }

        return { hasGap: false, status: CapabilityStatus.AVAILABLE };
    }

    private detectTaskCategory(input: string, taskType: TaskType | null): string | null {
        if (taskType === 'file_conversion' || /vídeo|video|convert[ea]|mp4|mkv|ffmpeg/i.test(input)) {
            return 'video_conversion';
        }
        if (/audio|áudio|mp3|wav|whisper|stt|tts/i.test(input)) {
            return 'audio_processing';
        }
        if (/estrutura|tree|pastas|arquivos|visualizar/i.test(input)) {
            return 'visualization';
        }
        if (/git|commit|push|pull|repo/i.test(input)) {
            return 'vcs';
        }
        if (/python|node|npm|pip|script|rodar|run/i.test(input)) {
            return 'automation';
        }
        return null;
    }

    private isToolRequired(input: string, tool: string): boolean {
        // Se a ferramenta é explicitamente mencionada ou exigida pelo contexto
        if (input.includes(tool)) return true;

        const contextMap: Record<string, string[]> = {
            'ffmpeg': ['converter', 'video', 'vídeo', 'audio', 'áudio', 'mp4', 'mp3'],
            'tree': ['estrutura de pastas', 'visualizar diretório', 'tree'],
            'git': ['commit', 'push', 'clonar', 'repo']
        };

        const triggers = contextMap[tool] || [];
        return triggers.some(t => input.includes(t));
    }
}
