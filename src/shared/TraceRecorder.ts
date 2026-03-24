import Database from 'better-sqlite3';
import path from 'path';
import { debugBus } from './DebugBus';

// Conecta ao banco de dados SQLite (na raiz do projeto)
const dbPath = path.join(process.cwd(), 'db.sqlite');
const db = new Database(dbPath);

// Cria as tabelas de observabilidade se não existirem
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
    debugBus.on('gateway', (data) => saveEvent('gateway', data));
    debugBus.on('thought', (data) => saveEvent('thought', data));
    debugBus.on('tool', (data) => saveEvent('tool', data));
    debugBus.on('rag', (data) => saveEvent('rag', data));
    console.log('[TraceRecorder] 🔴 Observabilidade e gravação de Traces ativada.');
}

function saveEvent(type: string, data: any) {
    if (!data.trace_id) return;

    // setImmediate garante que o I/O do banco vá para o final da fila (não bloqueia a IA)
    setImmediate(() => {
        try {
            const stmt = db.prepare(`INSERT INTO trace_events (trace_id, type, payload, created_at) VALUES (?, ?, ?, ?)`);
            // Limitamos o payload a 5000 caracteres para evitar que logs gigantes engulam o DB
            stmt.run(data.trace_id, type, JSON.stringify(data).slice(0, 5000), Date.now());
        } catch (err) {
            console.error('[TraceRecorder] Erro ao salvar evento:', err);
        }
    });
}