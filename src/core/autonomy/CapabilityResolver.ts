import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../shared/AppLogger';
import { TaskType } from '../agent/TaskClassifier';
import { TaskNature } from './ActionRouter';
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
    missing?: string[];
    installSuggestions?: string[];
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

import { findBinary, detectWhisper } from '../../shared/BinaryUtils';

/**
 * ProvisionerAdapter: Abstração para detecção e sugestão de ferramentas.
 */
export interface ProvisionerAdapter {
    isInstalled(tool: string): boolean;
    resolveSolution(tool: string): ResolutionProposal['solution'];
}

/**
 * DefaultProvisionerAdapter: Implementação robusta e multiplataforma.
 */
class DefaultProvisionerAdapter implements ProvisionerAdapter {
    isInstalled(tool: string): boolean {
        if (tool.toLowerCase() === 'whisper') {
            return detectWhisper().available;
        }
        return findBinary(tool) !== null;
    }

    resolveSolution(tool: string): ResolutionProposal['solution'] {
        const os = process.platform === 'win32' ? 'Windows' : 'Linux';
        const isWindows = process.platform === 'win32';

        const commands: Record<string, string> = {
            'ffmpeg': isWindows ? 'winget install ffmpeg' : 'sudo apt update && sudo apt install ffmpeg -y',
            'whisper_transcription': 'pip install openai-whisper',
            'git': isWindows ? 'winget install Git.Git' : 'sudo apt install git -y',
            'tree': isWindows ? 'winget install GnuWin32.Tree' : 'sudo apt install tree -y'
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
 * CapabilityResolver: Detecta lacunas entre a intenção do usuário e as capacidades do sistema.
 */
export class CapabilityResolver {
    private logger = createLogger('CapabilityResolver');
    private adapter: ProvisionerAdapter = new DefaultProvisionerAdapter();

    private readonly TASK_TOOL_MAP: Record<string, string[]> = {
        'video_conversion': ['ffmpeg'],
        'audio_processing': ['ffmpeg', 'whisper_transcription'],
        'visualization': ['tree'],
        'vcs': ['git'],
        'automation': ['python', 'node']
    };

    public resolve(input: string, taskType: TaskType | null, nature: TaskNature): ResolutionProposal {
        const text = input.toLowerCase();

        if (nature === TaskNature.INFORMATIVE) {
            return { hasGap: false, status: CapabilityStatus.AVAILABLE };
        }

        const category = this.detectTaskCategory(text, taskType);
        if (!category) {
            return { hasGap: false, status: CapabilityStatus.AVAILABLE };
        }

        const requiredTools = this.TASK_TOOL_MAP[category] || [];
        const missing: string[] = [];

        for (const tool of requiredTools) {
            if (this.isToolRequired(text, tool)) {
                if (!this.adapter.isInstalled(tool)) {
                    missing.push(tool);
                }
            }
        }

        if (missing.length > 0) {
            const primaryTool = missing[0];
            const solution = this.adapter.resolveSolution(primaryTool);

            const suggestions = missing.map(m => this.adapter.resolveSolution(m)?.command).filter(Boolean) as string[];

            return {
                hasGap: true,
                status: CapabilityStatus.MISSING,
                gap: {
                    resource: primaryTool,
                    reason: `Missing tools for ${category}`,
                    task: category,
                    severity: 'blocking',
                    missing: missing,
                    installSuggestions: suggestions
                },
                solution: solution
            };
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
        if (input.includes(tool.toLowerCase())) return true;

        const contextMap: Record<string, string[]> = {
            'ffmpeg': ['converter', 'video', 'vídeo', 'audio', 'áudio', 'mp4', 'mp3'],
            'whisper_transcription': ['transcrever', 'transcription', 'audio', 'áudio', 'voz', 'stt'],
            'tree': ['estrutura', 'pastas', 'visualizar'],
            'git': ['commit', 'push', 'repo']
        };

        const triggers = contextMap[tool.toLowerCase()] || [];
        return triggers.some(t => input.includes(t));
    }
}
