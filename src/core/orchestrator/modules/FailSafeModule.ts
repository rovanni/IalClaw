import { FailSafeSignal } from '../../../engine/AgentLoopTypes';

export class FailSafeModule {
    public decide(signal: FailSafeSignal): FailSafeSignal | undefined {
        // Micro-extração Fase 1.1: decisão direta e isolada.
        // Se o fail-safe não está ativado, mantém o próprio signal sem tocar em outros domínios.
        if (!signal.activated) {
            return signal;
        }

        return undefined;
    }

    public decideActivatedPassThrough(signal: FailSafeSignal): FailSafeSignal | undefined {
        // Micro-extração Fase 1.2: bloco coeso dependente apenas do próprio FailSafeSignal.
        if (signal.activated) {
            return signal;
        }

        return undefined;
    }

    public resolvePostAuditDecision(signal: FailSafeSignal): FailSafeSignal {
        // Fase 1.3: fechamento da decisão puramente local ao signal,
        // sem dependências de RouteAutonomy, Retry, PlanAdjustment ou auditoria.
        const postAuditDecision = this.decideActivatedPassThrough(signal);
        return postAuditDecision ?? signal;
    }
}
