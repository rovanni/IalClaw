import Database from 'better-sqlite3';
import path from 'path';
import { debugBus } from './DebugBus';

const dbPath = path.join(process.cwd(), 'db.sqlite');
const db = new Database(dbPath);

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

export function startTraceRecorder() {
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
        'repair:tool_input:baseline'
    ];

    for (const eventName of tracedEvents) {
        debugBus.on(eventName, (data) => saveEvent(eventName, data));
    }

    console.log('[TraceRecorder] Observabilidade e gravacao de traces ativada.');
}

function saveEvent(type: string, data: any) {
    if (!data.trace_id) return;

    setImmediate(() => {
        try {
            const stmt = db.prepare('INSERT INTO trace_events (trace_id, type, payload, created_at) VALUES (?, ?, ?, ?)');
            stmt.run(data.trace_id, type, JSON.stringify(data).slice(0, 5000), Date.now());
        } catch (err) {
            console.error('[TraceRecorder] Erro ao salvar evento:', err);
        }
    });
}
