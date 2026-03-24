import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import cors from 'cors';

export class DashboardServer {
    private app: express.Express;
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.app = express();
        this.app.use(cors());

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
    }

    public start(port: number = 3000) {
        this.app.listen(port, () => {
            console.log(`[Dashboard] Graph Visualization rodando em http://localhost:${port}`);
        });
    }
}
