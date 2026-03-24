import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import cors from 'cors';
import { AgentController } from '../core/AgentController';
import { agentConfig, isExecutionMode } from '../core/executor/AgentConfig';
import { debugBus } from '../shared/DebugBus';
import { SessionManager } from '../shared/SessionManager';

export class DashboardServer {
    private app: express.Express;
    private db: Database.Database;
    private controller?: AgentController;

    constructor(db: Database.Database) {
        this.db = db;
        this.app = express();
        this.app.use(cors());
        this.app.use(express.json());
        this.initializeAgentConfig();

        // Serve static files from public
        this.app.use(express.static(path.join(__dirname, 'public')));

        this.app.get('/', (_req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        this.app.get('/advanced', (_req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        this.app.get('/simple', (_req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'simple.html'));
        });

        this.app.get('/help', (_req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'help.html'));
        });

        // API route for graph data
        this.app.get('/api/graph', (req, res) => {
            try {
                const nodes = this.db.prepare('SELECT id, name, type, score FROM nodes').all();
                const edges = this.db.prepare('SELECT source, target, relation, weight FROM edges').all();

                res.json({
                    nodes: nodes.map((n: any) => ({
                        id: n.id,
                        label: n.name,
                        group: n.type,
                        value: n.score
                    })),
                    edges: edges.map((e: any) => ({
                        from: e.source,
                        to: e.target,
                        label: e.relation,
                        value: e.weight
                    }))
                });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        // API route for Web Chat
        this.app.post('/api/chat', async (req, res) => {
            if (!this.controller) {
                return res.status(500).json({ error: 'AgentController not linked' });
            }
            try {
                const { message, sessionId = 'web-session' } = req.body;
                if (!message) return res.status(400).json({ error: 'Message payload required' });

                const answer = await this.controller.handleWebMessage(sessionId, message);
                res.json({ answer });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/conversations', (_req, res) => {
            try {
                const conversations = this.db.prepare(`
                    SELECT
                        c.id AS conversation_id,
                        c.last_message_at AS last_activity,
                        c.message_count,
                        c.metadata,
                        m.role AS last_role,
                        m.content AS last_content
                    FROM conversations c
                    LEFT JOIN messages m ON m.id = (
                        SELECT id
                        FROM messages
                        WHERE conversation_id = c.id
                        ORDER BY id DESC
                        LIMIT 1
                    )
                    ORDER BY COALESCE(c.last_message_at, m.created_at) DESC
                    LIMIT 100
                `).all();

                res.json(conversations.map((conversation: any) => {
                    let metadata: Record<string, any> = {};

                    try {
                        metadata = conversation.metadata ? JSON.parse(conversation.metadata) : {};
                    } catch {
                        metadata = {};
                    }

                    return {
                        conversation_id: conversation.conversation_id,
                        title: metadata.title || conversation.last_content || conversation.conversation_id,
                        last_role: conversation.last_role,
                        last_content: conversation.last_content,
                        last_activity: conversation.last_activity,
                        message_count: conversation.message_count || 0
                    };
                }));
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/config', (_req, res) => {
            res.json({ success: true, config: agentConfig.getSnapshot() });
        });

        this.app.post('/api/config/mode', (req, res) => {
            const mode = req.body?.mode;

            if (!isExecutionMode(mode)) {
                return res.status(400).json({ error: 'Modo de execucao invalido.' });
            }

            const snapshot = agentConfig.setExecutionMode(mode);
            this.persistAgentConfig(snapshot.executionMode);
            debugBus.emit('agent_config', {
                source: 'dashboard',
                ...snapshot,
                timestamp: Date.now()
            });

            res.json({ success: true, config: snapshot });
        });

        this.app.get('/api/conversations/:conversationId', (req, res) => {
            try {
                const messages = this.db.prepare(`
                    SELECT id, conversation_id, role, content, tool_name, created_at
                    FROM messages
                    WHERE conversation_id = ?
                    ORDER BY id ASC
                `).all(req.params.conversationId);

                res.json(messages);
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/sessions/reset', (req, res) => {
            try {
                const { sessionId } = req.body || {};

                if (!sessionId || typeof sessionId !== 'string') {
                    return res.status(400).json({ error: 'sessionId is required' });
                }

                const session = SessionManager.resetVolatileState(sessionId);
                res.json({
                    success: true,
                    sessionId: session.conversation_id
                });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/trace/:traceId', (req, res) => {
            try {
                const events = this.db.prepare(`
                    SELECT type, payload, created_at
                    FROM trace_events
                    WHERE trace_id = ?
                    ORDER BY id ASC
                `).all(req.params.traceId);

                res.json(events);
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/debug/stream', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders?.();

            const forwardEvent = (eventName: string, payload: any) => {
                res.write(`event: ${eventName}\n`);
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
            };

            const gatewayListener = (payload: any) => forwardEvent('gateway', payload);
            const thoughtListener = (payload: any) => forwardEvent('thought', payload);
            const toolListener = (payload: any) => forwardEvent('tool', payload);
            const ragListener = (payload: any) => forwardEvent('rag', payload);
            const toolInputListener = (payload: any) => forwardEvent('tool_input_error', payload);
            const selfHealingListener = (payload: any) => forwardEvent('self_healing', payload);
            const selfHealingAbortListener = (payload: any) => forwardEvent('self_healing_abort', payload);
            const repairBaselineListener = (payload: any) => forwardEvent('repair:tool_input:baseline', payload);
            const repairRawListener = (payload: any) => forwardEvent('repair:tool_input:raw', payload);
            const repairNormalizedListener = (payload: any) => forwardEvent('repair:tool_input:normalized', payload);
            const executionModeListener = (payload: any) => forwardEvent('execution_mode', payload);
            const agentConfigListener = (payload: any) => forwardEvent('agent_config', payload);

            debugBus.on('gateway', gatewayListener);
            debugBus.on('thought', thoughtListener);
            debugBus.on('tool', toolListener);
            debugBus.on('rag', ragListener);
            debugBus.on('tool_input_error', toolInputListener);
            debugBus.on('self_healing', selfHealingListener);
            debugBus.on('self_healing_abort', selfHealingAbortListener);
            debugBus.on('repair:tool_input:baseline', repairBaselineListener);
            debugBus.on('repair:tool_input:raw', repairRawListener);
            debugBus.on('repair:tool_input:normalized', repairNormalizedListener);
            debugBus.on('execution_mode', executionModeListener);
            debugBus.on('agent_config', agentConfigListener);

            const heartbeat = setInterval(() => {
                res.write(': ping\n\n');
            }, 15000);

            req.on('close', () => {
                clearInterval(heartbeat);
                debugBus.off('gateway', gatewayListener);
                debugBus.off('thought', thoughtListener);
                debugBus.off('tool', toolListener);
                debugBus.off('rag', ragListener);
                debugBus.off('tool_input_error', toolInputListener);
                debugBus.off('self_healing', selfHealingListener);
                debugBus.off('self_healing_abort', selfHealingAbortListener);
                debugBus.off('repair:tool_input:baseline', repairBaselineListener);
                debugBus.off('repair:tool_input:raw', repairRawListener);
                debugBus.off('repair:tool_input:normalized', repairNormalizedListener);
                debugBus.off('execution_mode', executionModeListener);
                debugBus.off('agent_config', agentConfigListener);
                res.end();
            });
        });
    }

    public setController(controller: AgentController) {
        this.controller = controller;
    }

    private initializeAgentConfig() {
        try {
            const row = this.db.prepare('SELECT value FROM app_config WHERE key = ?').get('execution_mode') as { value?: string } | undefined;

            if (row?.value && isExecutionMode(row.value)) {
                agentConfig.setExecutionMode(row.value);
            }
        } catch (error: any) {
            console.warn('[Dashboard] Falha ao carregar execution_mode persistido:', error.message);
        }
    }

    private persistAgentConfig(mode: string) {
        try {
            this.db.prepare(`
                INSERT INTO app_config (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            `).run('execution_mode', mode, new Date().toISOString());
        } catch (error: any) {
            console.warn('[Dashboard] Falha ao persistir execution_mode:', error.message);
        }
    }

    public start(port: number = 3000) {
        this.app.listen(port, () => {
            console.log(`[Dashboard] Graph Visualization rodando em http://localhost:${port}`);
        });
    }
}
