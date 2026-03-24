import * as dotenv from 'dotenv';
import { DatabaseManager } from '../db/DatabaseManager';
import { ProviderFactory } from '../engine/ProviderFactory';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { AgentGateway } from '../engine/AgentGateway';

dotenv.config();

async function run() {
    const dbManager = new DatabaseManager('db.sqlite');
    const provider = ProviderFactory.getProvider();
    const memory = new CognitiveMemory(dbManager.getDb(), provider);
    const gateway = new AgentGateway(memory, provider);
    const identityNodes = await memory.getIdentityNodes();
    const agentNodes = identityNodes.filter(node => node.subtype === 'agent');

    const queries = [
        "código rodando devagar",
        "qual a previsão do tempo",
        "banco de dados corrompido"
    ];

    console.log("=== INICIANDO TESTE DO GATEWAY SEMÂNTICO ===");
    if (agentNodes.length === 0) {
        console.warn('[Gateway Test] Nenhum agente de identidade encontrado no banco. O roteamento deve cair no fallback geral.');
        console.warn('[Gateway Test] Rode: npx ts-node src/scripts/bootstrap-identities.ts');
    }

    let fallbackCount = 0;
    for (const q of queries) {
        const emb = await provider.embed(q);
        const agentId = await gateway.selectAgent(q, emb);
        if (agentId === 'identity:agent:general') {
            fallbackCount++;
        }
        console.log(`QUERY: "${q}"\n→ ROTA: ${agentId}\n`);
    }

    if (agentNodes.length === 0 && fallbackCount === queries.length) {
        console.warn('[Gateway Test] Banco sem identidades de gateway e todas as consultas foram roteadas para o fallback geral.');
    }

    dbManager.close();
}

run().catch(console.error);
