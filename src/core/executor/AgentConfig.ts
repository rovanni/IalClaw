export type ExecutionMode = 'strict' | 'balanced' | 'aggressive';

export interface ExecutionModeSnapshot {
    executionMode: ExecutionMode;
    safeMode: boolean;
    label: string;
    behavior: string;
    description: string;
}

const EXECUTION_MODE_METADATA: Record<ExecutionMode, Omit<ExecutionModeSnapshot, 'executionMode' | 'safeMode'>> = {
    strict: {
        label: 'Seguro',
        behavior: 'Diff obrigatorio, validacao rigida',
        description: 'Prioriza estabilidade e bloqueia overwrite completo quando o patch seguro falha.'
    },
    balanced: {
        label: 'Equilibrado',
        behavior: 'Fallback ativo, validacao leve',
        description: 'Tenta diff primeiro, aceita fallback inteligente e entrega progresso sem travar o fluxo.'
    },
    aggressive: {
        label: 'Livre',
        behavior: 'Overwrite direto, validacao minima',
        description: 'Prioriza resultado rapido, mesmo com menos protecoes durante a execucao.'
    }
};

export function isExecutionMode(value: unknown): value is ExecutionMode {
    return value === 'strict' || value === 'balanced' || value === 'aggressive';
}

function isSafeModeEnabledFromEnv(): boolean {
    const rawValue = process.env.SAFE_MODE ?? process.env.IALCLAW_SAFE_MODE;

    if (!rawValue) {
        return true;
    }

    const normalized = rawValue.trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}

export function getExecutionModeSnapshot(mode: ExecutionMode): ExecutionModeSnapshot {
    return {
        executionMode: mode,
        safeMode: isSafeModeEnabledFromEnv(),
        ...EXECUTION_MODE_METADATA[mode]
    };
}

class AgentConfigStore {
    private executionMode: ExecutionMode = 'balanced';
    private safeMode = isSafeModeEnabledFromEnv();

    getExecutionMode(): ExecutionMode {
        return this.executionMode;
    }

    isSafeModeEnabled(): boolean {
        return this.safeMode;
    }

    setSafeMode(enabled: boolean): ExecutionModeSnapshot {
        this.safeMode = enabled;
        return this.getSnapshot();
    }

    setExecutionMode(mode: ExecutionMode): ExecutionModeSnapshot {
        this.executionMode = mode;
        return this.getSnapshot();
    }

    getSnapshot(): ExecutionModeSnapshot {
        return {
            executionMode: this.executionMode,
            safeMode: this.safeMode,
            ...EXECUTION_MODE_METADATA[this.executionMode]
        };
    }
}

export const agentConfig = new AgentConfigStore();
