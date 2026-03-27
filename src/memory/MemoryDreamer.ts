import Database from 'better-sqlite3';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';

const logger = createLogger('MemoryDreamer');

export class MemoryDreamer {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    public dream() {
        logger.debug('dream_started', t('log.memory.dream_started'));
        try {
            this.pruneOldMessages();
            this.decayGraph();
            logger.debug('dream_completed', t('log.memory.dream_completed'));
        } catch (e: any) {
            logger.error('dream_failed', e, t('log.memory.dream_failed'));
        }
    }

    private pruneOldMessages() {
        const result = this.db.prepare(`
      DELETE FROM messages 
      WHERE created_at < datetime('now', '-30 days')
    `).run();
        if (result.changes > 0) {
            logger.debug('prune_completed', t('log.memory.prune_completed', { count: result.changes }));
        }
    }

    private decayGraph() {
        this.db.prepare(`UPDATE nodes SET score = score * 0.95 WHERE score > 0.1`).run();
        this.db.prepare(`UPDATE edges SET weight = weight * 0.95 WHERE weight > 0.1`).run();
        logger.debug('decay_completed', t('log.memory.decay_completed'));
    }
}
