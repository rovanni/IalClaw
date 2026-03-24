export type ExecutionMode = 'strict' | 'balanced' | 'aggressive';

export interface ExecutionModeSnapshot {
    executionMode: ExecutionMode;
    label: string;
    behavior: string;
    description: string;
}

const EXECUTION_MODE_METADATA: Record<ExecutionMode, Omit<ExecutionModeSnapshot, 'executionMode'>> = {
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

export function getExecutionModeSnapshot(mode: ExecutionMode): ExecutionModeSnapshot {
    return {
        executionMode: mode,
        ...EXECUTION_MODE_METADATA[mode]
    };
}

class AgentConfigStore {
    private executionMode: ExecutionMode = 'balanced';

    getExecutionMode(): ExecutionMode {
        return this.executionMode;
    }

    setExecutionMode(mode: ExecutionMode): ExecutionModeSnapshot {
        this.executionMode = mode;
        return this.getSnapshot();
    }

    getSnapshot(): ExecutionModeSnapshot {
        return getExecutionModeSnapshot(this.executionMode);
    }
}

export const agentConfig = new AgentConfigStore();
