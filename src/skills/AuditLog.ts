import fs from 'fs';
import path from 'path';

export type AuditStatus =
    | 'approved'
    | 'approved_with_restrictions'
    | 'manual_review'
    | 'quarantined'
    | 'blocked';

type AuditEntry = {
    skill: string;
    status: AuditStatus;
    score: number;
    date: string;
    agent: string;
};

/**
 * Lê o log de auditoria gerado pelo skill-auditor e expõe consultas de status.
 *
 * O arquivo é criado e escrito pelo skill-auditor (SKILL.md, Passo 6).
 * O runtime apenas lê — nunca escreve neste arquivo.
 *
 * Formato do arquivo (JSON Lines):
 *   {"skill":"sandeco-maestro","status":"approved","score":5,"date":"2026-03-25T...","agent":"skill-auditor"}
 *   {"skill":"evil-skill","status":"blocked","score":95,"date":"2026-03-25T...","agent":"skill-auditor"}
 */
export class AuditLog {
    private entries = new Map<string, AuditEntry>();

    constructor(private logPath: string) {
        this.load();
    }

    /**
     * Recarrega o log do disco. Útil para hot-reload sem reiniciar o agente.
     */
    reload(): void {
        this.load();
    }

    /**
     * Retorna o status de auditoria mais recente para uma skill, ou null se
     * nunca foi auditada.
     */
    getStatus(skillName: string): AuditStatus | null {
        return this.entries.get(skillName.toLowerCase())?.status ?? null;
    }

    /**
     * Uma skill é ativável somente se foi auditada e aprovada.
     * Skills sem entrada no log são consideradas não auditadas e bloqueadas.
     */
    isActivatable(skillName: string): boolean {
        const status = this.getStatus(skillName);
        return status === 'approved' || status === 'approved_with_restrictions';
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private load(): void {
        this.entries.clear();

        if (!fs.existsSync(this.logPath)) return;

        const lines = fs.readFileSync(this.logPath, 'utf8')
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean);

        for (const line of lines) {
            try {
                const entry: AuditEntry = JSON.parse(line);
                if (entry.skill && entry.status) {
                    // A última entrada vence em caso de múltiplas auditorias
                    this.entries.set(entry.skill.toLowerCase(), entry);
                }
            } catch {
                // Linha malformada — ignorar silenciosamente
            }
        }
    }
}

/**
 * Cria um AuditLog apontando para data/skill-audit-log.json relativo à raiz
 * do projeto (um nível acima de src/).
 */
export function createAuditLog(projectRoot: string): AuditLog {
    const logPath = path.join(projectRoot, 'data', 'skill-audit-log.json');
    // Garante que a pasta data/ exista (o skill-auditor já cria via bash,
    // mas um boot limpo pode não tê-la ainda)
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return new AuditLog(logPath);
}
