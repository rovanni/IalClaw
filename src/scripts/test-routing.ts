import Database from 'better-sqlite3';
import { ProviderFactory } from '../engine/ProviderFactory';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { AgentGateway } from '../engine/AgentGateway';

async function run() {
    const db = new Database('ialclaw.db');
    const provider = ProviderFactory.getProvider();
    const memory = new CognitiveMemory(db, provider);
    const gateway = new AgentGateway(memory, provider);

    const queries = [
        "código rodando devagar",
        "qual a previsão do tempo",
        "banco de dados corrompido"
    ];

    console.log("=== INICIANDO TESTE DO GATEWAY SEMÂNTICO ===");
    for (const q of queries) {
        const emb = await provider.embed(q);
        const agentId = await gateway.selectAgent(q, emb);
        console.log(`QUERY: "${q}"\n→ ROTA: ${agentId}\n`);
    }
}

run().catch(console.error);
