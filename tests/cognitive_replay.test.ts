import { ScenarioSimulator } from './utils/ScenarioSimulator';
import { CognitiveStrategy } from '../src/core/orchestrator/CognitiveOrchestrator';
import { FlowRegistry } from '../src/core/flow/FlowRegistry';
import * as fs from 'fs';

async function runCognitiveReplay() {
    console.log('🎬 Iniciando Replay Cognitivo de Sessão Encadeada (Caminho C)\n');
    const sessionId = 'replay-' + Date.now();
    const sim = new ScenarioSimulator(sessionId);
    const timeline: any[] = [];

    // 1. Registro de múltiplos flows para testar Candidatos (Caminho A)
    FlowRegistry.registerDefinition({
        id: 'presentation_expert',
        flowClass: class { id = 'presentation_expert'; steps = []; async onComplete() { return {}; } } as any,
        tags: ['slides', 'presentation', 'powerpoint'],
        triggers: ['gerar slides'],
        priority: 5
    });

    FlowRegistry.registerDefinition({
        id: 'document_generator',
        flowClass: class { id = 'document_generator'; steps = []; async onComplete() { return {}; } } as any,
        tags: ['slides', 'document', 'pdf'],
        triggers: ['criar documento'],
        priority: 5
    });

    const interactions = [
        { input: 'Olá, bom dia!', label: 'Saudação Inicial' },
        { input: 'Quero algo com slides e powerpoint', label: 'Ambiguidade: match de múltiplas tags' },
        { input: 'apresentacao html', label: 'Trigger Específico' },
        { input: 'Espera, na verdade organiza meus arquivos', label: 'Interrupção/Mudança de Intenção' },
        { input: 'Não, esquece. Vamos voltar aos slides.', label: 'Retorno ao Contexto' },
        { input: 'Título vai ser "Projeto Claw"', label: 'Interação de Step do Flow' }
    ];

    for (const step of interactions) {
        console.log(`\nStep: ${step.label}`);
        console.log(`Input: "${step.input}"`);
        
        try {
            const res = await sim.simulate(step.input);
            
            // Coleta de telemetria de candidatos
            const flowDecision = res.debugLogs.find(l => l.type === 'flow_start_decision');
            const candidates = flowDecision?.candidates || [];
            
            console.log(`Decision: ${res.decision.strategy} (Flow: ${res.decision.flowId || 'N/A'})`);
            if (candidates.length > 0) {
                console.log(`Candidatos Rejeitados: ${candidates.length} [${candidates.map((c: any) => c.flowId).join(', ')}]`);
            }

            timeline.push({
                step: step.label,
                input: step.input,
                strategy: res.decision.strategy,
                flowId: res.decision.flowId,
                reason: res.decision.reason,
                candidates: candidates,
                confidence: res.decision.confidence
            });
        } catch (e: any) {
            console.error(`❌ Erro no step "${step.label}":`, e.message);
            console.error(e.stack);
            throw e;
        }
    }

    // --- SALVAR TIMELINE ---
    fs.writeFileSync('tests/behavioral_replay.json', JSON.stringify(timeline, null, 2));
    console.log('\n🏁 Replay Cognitivo Finalizado. Timeline em tests/behavioral_replay.json');
}

runCognitiveReplay().catch(err => {
    console.error('💥 Erro fatal no replay:', err);
    process.exit(1);
});
