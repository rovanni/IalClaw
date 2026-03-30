export type Capability =
    | 'browser_execution'
    | 'fs_access'
    | 'node_execution'
    | 'git'
    | 'docker'
    | 'test_runner'
    | 'whisper_transcription'
    | 'tts_generation';

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
