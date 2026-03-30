// ── SecurityPolicyProvider: Central de Regras de Risco ────────────────────────
// Unifica a detecção de operações perigosas para todo o sistema.
// "Segurança não é um anexo, é o alicerce."

export type RiskLevel = 'low' | 'medium' | 'high';

export interface SecurityPolicy {
    riskLevel: RiskLevel;
    isDestructive: boolean;
}

export class SecurityPolicyProvider {
    /**
     * Termos que indicam operações de ALTO RISCO (destrutivas).
     */
    private readonly HIGH_RISK_PATTERNS = [
        /delete/i, /remove/i, /remover/i, /excluir/i, /drop/i,
        /truncate/i, /format/i, /rm\s+/i, /del\s+/i, /purge/i,
        /wipe/i, /erase/i, /destroy/i, /uninstall/i
    ];

    /**
     * Termos que indicam operações de MÉDIO RISCO (mutação).
     */
    private readonly MEDIUM_RISK_PATTERNS = [
        /install/i, /instale/i, /instalar/i, /add/i, /adicionar/i,
        /write/i, /escrever/i, /create/i, /criar/i, /update/i, /save/i, /salvar/i,
        /push/i, /deploy/i, /publish/i, /executar/i, /rodar/i, /run/i
    ];

    /**
     * Detecta o nível de risco de um input ou intenção.
     */
    public detectRisk(input: string): RiskLevel {
        if (this.HIGH_RISK_PATTERNS.some(p => p.test(input))) {
            return 'high';
        }

        if (this.MEDIUM_RISK_PATTERNS.some(p => p.test(input))) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Verifica se a ação é explicitamente destrutiva.
     */
    public isDestructive(input: string): boolean {
        return this.HIGH_RISK_PATTERNS.some(p => p.test(input));
    }

    /**
     * Retorna a política completa para um input.
     */
    public getPolicy(input: string): SecurityPolicy {
        return {
            riskLevel: this.detectRisk(input),
            isDestructive: this.isDestructive(input)
        };
    }
}

// Singleton para uso global
let policyInstance: SecurityPolicyProvider | null = null;

export function getSecurityPolicy(): SecurityPolicyProvider {
    if (!policyInstance) {
        policyInstance = new SecurityPolicyProvider();
    }
    return policyInstance;
}
