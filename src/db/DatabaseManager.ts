import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../shared/AppLogger';

const dbLogger = createLogger('DatabaseManager');

export class DatabaseManager {
    private db: Database.Database;

    constructor(dbPath: string = 'db.sqlite') {
        this.db = new Database(dbPath);
        this.initialize();
    }

    private initialize() {
        // Read the schema.sql file
        const schemaPath = path.resolve(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf-8');

            // better-sqlite3 exec runs multiple statements
            this.db.exec(schema);
        } else {
            dbLogger.warn('schema_not_found', `Schema file not found at ${schemaPath}`);
        }
    }

    public getDb(): Database.Database {
        return this.db;
    }

    public close() {
        this.db.close();
    }
}
