import Database from 'better-sqlite3';
import path from 'path';
import { debugBus } from './DebugBus';
import { createLogger } from './AppLogger';

const traceLogger = createLogger('TraceRecorder');

let db: Database.Database | null = null;
let eventQueue: Array<{ type: string; data: any }> = [];
let isShuttingDown = false;

function initDatabase(): boolean {
    try {
        const dbPath = path.join(process.cwd(), 'db.sqlite');
        db = new Database(dbPath);

        db.exec(`
            CREATE TABLE IF NOT EXISTS traces (
                id TEXT PRIMARY KEY,
                started_at INTEGER,
                ended_at INTEGER,
                status TEXT
            );
            CREATE TABLE IF NOT EXISTS trace_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT,
                type TEXT,
                payload TEXT,
                created_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_trace_id ON trace_events(trace_id);
        `);

        return true;
    } catch (err) {
        traceLogger.error('trace_db_init_failed', err, 'Falha ao inicializar banco de traces');
        return false;
    }
}

function flushQueue(): void {
    if (!db || eventQueue.length === 0) return;

    const queue = eventQueue;
    eventQueue = [];

    for (const { type, data } of queue) {
        try {
            const stmt = db.prepare('INSERT INTO trace_events (trace_id, type, payload, created_at) VALUES (?, ?, ?, ?)');
            stmt.run(data.trace_id, type, JSON.stringify(data).slice(0, 5000), Date.now());
        } catch (err) {
            traceLogger.error('trace_save_failed', err, 'Erro ao salvar evento do buffer');
        }
    }
}

function gracefulShutdown(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    flushQueue();

    try {
        if (db) {
            db.close();
            db = null;
        }
    } catch (err) {
        traceLogger.error('trace_db_close_failed', err, 'Erro ao fechar banco');
    }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('beforeExit', flushQueue);

export function startTraceRecorder(): boolean {
    if (!initDatabase()) {
        traceLogger.warn('trace_recorder_start_failed', 'Banco de traces não disponível');
        return false;
    }

    const tracedEvents = [
        'gateway',
        'thought',
        'tool',
        'rag',
        'executor:attempt',
        'executor:replan',
        'executor:success',
        'execution_success',
        'self_healing',
        'self_healing_abort',
        'tool_call',
        'tool_input_error',
        'repair:tool_input:raw',
        'repair:tool_input:normalized',
        'repair:tool_input:baseline',
        'planner_diagnostics',
        'runtime_decision',
        'direct_execution',
        'repair_metrics',
        'execution_result',
        'execution_summary',
        'execution_mode',
        'agent_config',
        'diff_strategy_selected',
        'diff_validation_failed',
        'diff_applied',
        'diff_fallback_triggered',
        'anchor_resolved',
        'anchor_resolution_failed',
        'dom_decision',
        'browser_skipped',
        'browser_validation_enabled',
        'capability_required',
        'capability_available',
        'capability_fallback',
        'skill_not_found',
        'skill_missing',
        'skill_install_required',
        'skill_auto_install_start',
        'skill_auto_install_result',
        'skill_auto_install_failed'
    ];

    for (const eventName of tracedEvents) {
        debugBus.on(eventName, (data) => saveEvent(eventName, data));
    }

    traceLogger.debug('trace_recorder_started', 'Observabilidade e gravacao de traces ativada');
    return true;
}

function saveEvent(type: string, data: any) {
    if (!data.trace_id || isShuttingDown) return;

    if (!db) {
        eventQueue.push({ type, data });
        if (eventQueue.length > 1000) {
            eventQueue = eventQueue.slice(-500);
        }
        return;
    }

    try {
        const stmt = db.prepare('INSERT INTO trace_events (trace_id, type, payload, created_at) VALUES (?, ?, ?, ?)');
        stmt.run(data.trace_id, type, JSON.stringify(data).slice(0, 5000), Date.now());
    } catch (err) {
        traceLogger.error('trace_save_failed', err, 'Erro ao salvar evento');
        eventQueue.push({ type, data });
    }
}
