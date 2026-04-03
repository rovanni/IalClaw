import { StopContinueSignal } from '../../../engine/AgentLoop';

export class StopContinueModule {
    public decide(signal: StopContinueSignal): StopContinueSignal | undefined {
        if (this.isContextFreePassThrough(signal)) {
            return signal;
        }

        return undefined;
    }

    public isRecoveryContinuationEligible(signal: StopContinueSignal): boolean {
        return signal.shouldStop && (
            signal.reason === 'low_improvement_delta' ||
            signal.reason === 'over_execution_detected'
        );
    }

    public isRecurrentFailureEscalationEligible(signal: StopContinueSignal): boolean {
        return signal.shouldStop === false;
    }

    public createRecoveryContinuationDecision(signal: StopContinueSignal): StopContinueSignal {
        return {
            ...signal,
            shouldStop: false,
            reason: 'execution_continues'
        };
    }

    public createRecurrentFailureStopDecision(signal: StopContinueSignal): StopContinueSignal {
        return {
            ...signal,
            shouldStop: true,
            reason: 'recurrent_failure_detected'
        };
    }

    private isContextFreePassThrough(signal: StopContinueSignal): boolean {
        return signal.shouldStop && !this.isRecoveryContinuationEligible(signal);
    }
}