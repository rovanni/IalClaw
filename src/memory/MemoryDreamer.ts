import Database from 'better-sqlite3';

export class MemoryDreamer {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    public dream() {
        console.log("[MemoryDreamer] Iniciando ciclo de consolidação de memória...");
        try {
            this.pruneOldMessages();
            this.decayGraph();
            console.log("[MemoryDreamer] Ciclo de sonho concluído com sucesso.");
        } catch (e: any) {
            console.error("[MemoryDreamer] Erro ao consolidar memória:", e);
        }
    }

    private pruneOldMessages() {
        const result = this.db.prepare(`
      DELETE FROM messages 
      WHERE created_at < datetime('now', '-30 days')
    `).run();
        if (result.changes > 0) {
            console.log(`[MemoryDreamer] Poda: Removidas ${result.changes} mensagens episódicas antigas.`);
        }
    }

    private decayGraph() {
        this.db.prepare(`UPDATE nodes SET score = score * 0.95 WHERE score > 0.1`).run();
        this.db.prepare(`UPDATE edges SET weight = weight * 0.95 WHERE weight > 0.1`).run();
        console.log(`[MemoryDreamer] Decaimento: Grafos reduzidos em 5% para evidenciar nós relevantes.`);
    }
}
