import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import cors from 'cors';
import { AgentController } from '../core/AgentController';
import { debugBus } from '../shared/DebugBus';

export class DashboardServer {
    private app: express.Express;
    private db: Database.Database;
    private controller?: AgentController;

    constructor(db: Database.Database) {
        this.db = db;
        this.app = express();
        this.app.use(cors());
        this.app.use(express.json());

        // Serve static files from public
        this.app.use(express.static(path.join(__dirname, 'public')));

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

            debugBus.on('gateway', gatewayListener);
            debugBus.on('thought', thoughtListener);
            debugBus.on('tool', toolListener);
            debugBus.on('rag', ragListener);

            const heartbeat = setInterval(() => {
                res.write(': ping\n\n');
            }, 15000);

            req.on('close', () => {
                clearInterval(heartbeat);
                debugBus.off('gateway', gatewayListener);
                debugBus.off('thought', thoughtListener);
                debugBus.off('tool', toolListener);
                debugBus.off('rag', ragListener);
                res.end();
            });
        });
    }

    public setController(controller: AgentController) {
        this.controller = controller;
    }

    public start(port: number = 3000) {
        this.app.listen(port, () => {
            console.log(`[Dashboard] Graph Visualization rodando em http://localhost:${port}`);
        });
    }
}
