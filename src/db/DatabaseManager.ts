import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../shared/AppLogger';

const dbLogger = createLogger('DatabaseManager');

export class DatabaseManager {
    private db: Database.Database;
    private ready = false;
    private static instance: DatabaseManager | null = null;
    private static lastPath: string | null = null;

    constructor(dbPath: string = 'ialclaw.sqlite') {
        const resolvedDbPath = path.resolve(dbPath);
        dbLogger.info('db_path', `Banco de dados será criado/em: ${resolvedDbPath}`);


        // Garante que o diretório existe
        const dbDir = path.dirname(resolvedDbPath);
        try {
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
                dbLogger.info('db_dir_created', `Diretório do banco criado: ${dbDir}`);
            }
        } catch (dirErr) {
            dbLogger.error('db_dir_create_failed', `Falha ao criar diretório do banco: ${dbDir}\nErro: ${dirErr}`);
            throw dirErr;
        }

        // Corrige permissões automaticamente (Linux/macOS)
        try {
            const stats = fs.statSync(dbDir);
            const mode = stats.mode & 0o777;
            if (mode !== 0o755 && mode !== 0o775 && mode !== 0o777) {
                fs.chmodSync(dbDir, 0o755);
                dbLogger.info('db_dir_perm_fixed', `Permissões do diretório corrigidas para 755: ${dbDir}`);
            }
            fs.accessSync(dbDir, fs.constants.W_OK);
        } catch (permErr) {
            try {
                fs.chmodSync(dbDir, 0o755);
                fs.accessSync(dbDir, fs.constants.W_OK);
                dbLogger.info('db_dir_perm_fixed', `Permissões corrigidas: ${dbDir}`);
            } catch (fixErr) {
                throw new Error(`Permissão de escrita negada para o diretório do banco: ${dbDir}. Tentativa de correção falhou. Erro: ${fixErr}`);
            }
        }

        // Remove APENAS arquivos auxiliares corrompidos (journal, wal, shm)
                // NÃO remove o arquivo principal do banco (ialclaw.sqlite)
                const auxiliaryFiles = [
                    `${resolvedDbPath}-journal`,
                    `${resolvedDbPath}-wal`,
                    `${resolvedDbPath}-shm`,
                ];
                for (const filePath of auxiliaryFiles) {
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                            dbLogger.info('db_auxiliary_file_removed', `Arquivo auxiliar removido: ${filePath}`);
                        }
                    } catch (removeErr) {
                        dbLogger.warn('db_file_remove_failed', `Não foi possível remover ${filePath}: ${removeErr}`);
                    }
                }

        try {
            this.db = new Database(resolvedDbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('busy_timeout = 10000');
            this.db.pragma('synchronous = NORMAL');
        } catch (dbErr) {
            dbLogger.error('db_open_failed', `Falha ao abrir/criar banco: ${resolvedDbPath}\nErro: ${dbErr}`);
            throw dbErr;
        }

        DatabaseManager.lastPath = resolvedDbPath;
        DatabaseManager.instance = this;
        this.initialize();
    }

    public static getInstance(dbPath: string = 'ialclaw.sqlite'): DatabaseManager {
        const resolvedPath = path.resolve(dbPath);
        const shouldReplace =
            !DatabaseManager.instance ||
            DatabaseManager.lastPath !== resolvedPath ||
            !DatabaseManager.instance.isOpen();

        if (shouldReplace) {
            if (
                DatabaseManager.instance &&
                DatabaseManager.lastPath !== resolvedPath &&
                DatabaseManager.instance.isOpen()
            ) {
                DatabaseManager.instance.close();
            }

            DatabaseManager.instance = new DatabaseManager(dbPath);
        }

        if (!DatabaseManager.instance) {
            throw new Error('DatabaseManager instance could not be created.');
        }

        return DatabaseManager.instance;
    }

    private initialize() {
        const schemaPath = path.resolve(__dirname, 'schema.sql');
        dbLogger.info('schema_path', `Arquivo de schema esperado em: ${schemaPath}`);

        if (!fs.existsSync(schemaPath)) {
            dbLogger.error('schema_not_found', `Schema file not found at ${schemaPath}`);
            throw new Error(`Schema file not found: ${schemaPath}`);
        }

        try {
            const schema = fs.readFileSync(schemaPath, 'utf-8');
            const allStatements = schema.split(';').filter(s => s.trim().length > 0);

            const pragmas = allStatements.filter(s => s.trim().toUpperCase().startsWith('PRAGMA'));
            const otherStatements = allStatements.filter(s => !s.trim().toUpperCase().startsWith('PRAGMA'));

            for (const pragma of pragmas) {
                const pragmaValue = pragma.split('=')[1]?.trim();
                if (pragmaValue) {
                    this.db.pragma(pragmaValue);
                } else {
                    dbLogger.warn('pragma_parse_failed', `Não foi possível interpretar PRAGMA: ${pragma}`);
                }
            }

            for (const stmt of otherStatements) {
                try {
                    this.db.prepare(stmt).run();
                } catch (stmtErr) {
                    dbLogger.error('stmt_failed', `Erro ao executar statement: ${stmt}\nErro: ${stmtErr}`);
                    throw stmtErr;
                }
            }

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

    public isOpen(): boolean {
        return Boolean(this.db?.open);
    }

    public close() {
        if (this.db && this.db.open) {
            this.db.close();
        }

        this.ready = false;

        if (DatabaseManager.instance === this) {
            DatabaseManager.instance = null;
            DatabaseManager.lastPath = null;
        }
    }
}
