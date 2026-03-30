import Database from 'better-sqlite3';
import { LLMProvider } from '../engine/ProviderFactory';
import { createLogger } from '../shared/AppLogger';

export interface ToolDecision {
    taskType: string;
    step: string;
    tool: string | null;
    success: boolean;
    timestamp: number;
}

export class DecisionMemory {
    private db: Database.Database;
    private logger = createLogger('DecisionMemory');

    constructor(db: Database.Database, _provider: LLMProvider) {
        this.db = db;
        this.ensureTable();
    }

    private ensureTable() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tool_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type TEXT,
                step TEXT,
                tool TEXT,
                success INTEGER,
                timestamp INTEGER
            )
        `);
    }

    /**
     * Armazena uma decisão de ferramenta e seu resultado para aprendizado futuro.
     */
    public async store(decision: ToolDecision): Promise<void> {
        try {
            this.db.prepare(`
                INSERT INTO tool_decisions (task_type, step, tool, success, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                decision.taskType,
                decision.step,
                decision.tool,
                decision.success ? 1 : 0,
                decision.timestamp
            );
        } catch (error: any) {
            this.logger.error('store_failed', `Erro ao salvar decisão: ${error.message}`);
        }
    }

    /**
     * Retorna estatísticas de uso para uma tarefa específica.
     */
    public getToolStats(taskType: string) {
        return this.db.prepare(`
            SELECT tool, 
                   COUNT(*) as total, 
                   SUM(success) as successes 
            FROM tool_decisions 
            WHERE task_type = ? 
            GROUP BY tool
        `).all(taskType);
    }
}
