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

    public resolve(
        input: string,
        taskType: TaskType | null,
        nature: TaskNature,
        signal?: { capability: string; reason: string }
    ): ResolutionProposal {
        const text = input.toLowerCase();

        if (nature === TaskNature.INFORMATIVE) {
            return { hasGap: false, status: CapabilityStatus.AVAILABLE };
        }

        // ── NOVO: Signal Boost (Evidência externa do InputHandler) ──────────
        // Se temos um sinal explícito, aumentamos a prioridade dessa detecção
        let signaledTool: string | null = null;
        if (signal?.capability) {
            signaledTool = signal.capability;
            this.logger.info('capability_signal_received', '[RESOLVER] Sinal externo recebido', {
                capability: signaledTool
            });
        }

        const category = this.detectTaskCategory(text, taskType);

        // Se não detectou categoria por heurística mas temos um signal, 
        // tentamos inferir a categoria a partir do signal
        let effectiveCategory = category;
        if (!effectiveCategory && signaledTool) {
            if (signaledTool === 'whisper_transcription' || signaledTool === 'ffmpeg') {
                effectiveCategory = 'audio_processing';
            }
        }

        if (!effectiveCategory && !signaledTool) {
            return { hasGap: false, status: CapabilityStatus.AVAILABLE };
        }

        const requiredTools = effectiveCategory ? (this.TASK_TOOL_MAP[effectiveCategory] || []) : [];
        const missing: string[] = [];

        // Check tools from category
        for (const tool of requiredTools) {
            if (this.isToolRequired(text, tool) || tool === signaledTool) {
                if (!this.adapter.isInstalled(tool)) {
                    missing.push(tool);
                }
            }
        }

        // Se temos um signal mas ele não estava no MAP ou não foi detectado, 
        // forçamos a verificação dele se for pertinente
        if (signaledTool && !missing.includes(signaledTool)) {
            if (!this.adapter.isInstalled(signaledTool)) {
                missing.push(signaledTool);
            }
        }

        if (missing.length > 0) {
            // Priorizar a ferramenta sinalizada se estiver na lista de faltantes
            const primaryTool = (signaledTool && missing.includes(signaledTool))
                ? signaledTool
                : missing[0];

            const solution = this.adapter.resolveSolution(primaryTool);
            const suggestions = missing.map(m => this.adapter.resolveSolution(m)?.command).filter(Boolean) as string[];

            return {
                hasGap: true,
                status: CapabilityStatus.MISSING,
                gap: {
                    resource: primaryTool,
                    reason: signal?.reason || `Missing tools for ${effectiveCategory || 'requested task'}`,
                    task: effectiveCategory || 'signaled_capability',
                    severity: 'blocking',
                    missing: missing,
                    installSuggestions: suggestions
                },
                solution: solution
            };
        }

        // Detecção de falha de permissão (sudo)
        const isPermissionError = text.includes('sudo_failed_non_interactive') ||
            text.includes('password required') ||
            text.includes('permission denied');

        if (isPermissionError && process.platform !== 'win32') {
            return {
                hasGap: true,
                status: CapabilityStatus.MISSING,
                gap: {
                    resource: 'sudo_permissions',
                    reason: 'Command failed due to sudo requirement in non-interactive mode',
                    task: 'system_permissions',
                    severity: 'blocking'
                },
                solution: {
                    type: 'install',
                    tool: 'sudo_permissions',
                    command: 'setup-system-permissions',
                    requiresConfirmation: true
                }
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
