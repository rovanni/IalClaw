import Database from 'better-sqlite3';
import { createLogger } from '../shared/AppLogger';

const logger = createLogger('MemoryDreamer');

export class MemoryDreamer {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    public dream() {
        logger.debug('dream_started', 'Iniciando ciclo de consolidação de memória');
        try {
            this.pruneOldMessages();
            this.decayGraph();
            logger.debug('dream_completed', 'Ciclo de sonho concluído com sucesso');
        } catch (e: any) {
            logger.error('dream_failed', 'Erro ao consolidar memória', undefined, e);
        }
    }

    private pruneOldMessages() {
        const result = this.db.prepare(`
      DELETE FROM messages 
      WHERE created_at < datetime('now', '-30 days')
    `).run();
        if (result.changes > 0) {
            logger.debug('prune_completed', `Removidas ${result.changes} mensagens episódicas antigas`);
        }
    }

    private decayGraph() {
        this.db.prepare(`UPDATE nodes SET score = score * 0.95 WHERE score > 0.1`).run();
        this.db.prepare(`UPDATE edges SET weight = weight * 0.95 WHERE weight > 0.1`).run();
        logger.debug('decay_completed', 'Grafos reduzidos em 5% para evidenciar nós relevantes');
    }
}
