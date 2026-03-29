import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../shared/AppLogger';

const dbLogger = createLogger('DatabaseManager');

export class DatabaseManager {
    private db: Database.Database;
    private ready = false;
    private static instance: DatabaseManager;

    constructor(dbPath: string = 'db.sqlite') {
        const instanceKey = `db_${path.resolve(dbPath)}`;
        
        if (DatabaseManager.instance && (DatabaseManager as any)._lastPath === instanceKey) {
            this.db = DatabaseManager.instance.db;
            this.ready = DatabaseManager.instance.ready;
            return;
        }

        this.db = new Database(dbPath);
        this.db.pragma('busy_timeout = 5000');
        (DatabaseManager as any)._lastPath = instanceKey;
        DatabaseManager.instance = this;
        this.initialize();
    }

    public static getInstance(dbPath: string = 'db.sqlite'): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager(dbPath);
        }
        return DatabaseManager.instance;
    }

    private initialize() {
        const schemaPath = path.resolve(__dirname, 'schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            dbLogger.error('schema_not_found', `Schema file not found at ${schemaPath}`);
            throw new Error(`Schema file not found: ${schemaPath}`);
        }

        try {
            const schema = fs.readFileSync(schemaPath, 'utf-8');
            this.db.exec(schema);

            const result = this.db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'")
                .get();

            if (!result) {
                throw new Error('Schema init failed - nodes table not created');
            }

            this.ready = true;
            dbLogger.info('db_initialized', `Database initialized at: ${this.db.name}`);
        } catch (err) {
            dbLogger.error('schema_init_failed', err);
            throw err;
        }
    }

    public getDb(): Database.Database {
        return this.db;
    }

    public isReady(): boolean {
        return this.ready;
    }

    public close() {
        if (this.db && this.db.open) {
            this.db.close();
        }
    }
}
