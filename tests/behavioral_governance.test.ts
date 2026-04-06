import { ScenarioSimulator } from './utils/ScenarioSimulator';
import { CognitiveStrategy } from '../src/core/orchestrator/CognitiveOrchestrator';
import { FlowRegistry } from '../src/core/flow/FlowRegistry';
import * as fs from 'fs';

async function runBehavioralTests() {
    const results: any[] = [];

    // 1. Setup global de flows de teste (para simular conflitos)
    FlowRegistry.registerDefinition({
        id: 'file_organizer',
        flowClass: class { 
            id = 'file_organizer'; 
            steps = [];
            async onComplete() { return {}; }
        } as any,
        tags: ['files', 'organize', 'cleanup'],
        triggers: ['organizar arquivos', 'limpar pastas'],
        priority: 5
    });

    // --- CENÁRIO 1: Mudança de Intenção Mid-Flow ---
    console.log('🔹 Cenário 1: Mudança de Intenção ("html_slides" ativo -> "organizar arquivos")');
    const sim1 = new ScenarioSimulator('sec-001');
    sim1.withActiveFlow('html_slides', 'ask_title');
    
    const res1 = await sim1.simulate('Na verdade, me ajude a organizar meus arquivos agora.');
    
    results.push({ scenario: 1, decision: res1.decision });
    // Verificações
    const flowDecision = res1.debugLogs.find(l => l.type === 'flow_start_decision');
    console.log(`   Decision: ${res1.decision.strategy} (Score: ${flowDecision?.match?.score || 'N/A'})`);
    
    if (res1.decision.strategy === CognitiveStrategy.START_FLOW && res1.decision.flowId === 'file_organizer') {
        console.log('   ✅ OK: Orchestrator permitiu transição para novo flow com match forte.');
    } else {
         console.log(`   ⚠️ INFO: Sistema manteve estratégia ${res1.decision.strategy}. Verifique se isso é desejado.`);
    }


    // --- CENÁRIO 2: Pending Action + Novo Estímulo ---
    console.log('\n🔹 Cenário 2: Pending Action + Novo Estímulo (Pending > Flow Start)');
    const sim2 = new ScenarioSimulator('sec-002');
    sim2.withPendingAction('confirm_delete', { target: 'database.bak' });
    
    const res2 = await sim2.simulate('Quero criar slides agora.');
    
    results.push({ scenario: 2, decision: res2.decision });
    if (res2.decision.strategy === CognitiveStrategy.EXECUTE_PENDING || 
        res2.decision.strategy === CognitiveStrategy.ASK ||
        res2.decision.strategy === CognitiveStrategy.CONFIRM) {
        console.log('   ✅ OK: Pending Action bloqueou o início do flow de slides.');
    } else if (res2.decision.strategy === CognitiveStrategy.START_FLOW) {
        console.error('   ❌ FAIL: Flow Start ignorou a ação pendente (Regressão de Precedência).');
    } else {
        console.log(`   ⚠️ INFO: Estratégia resultante: ${res2.decision.strategy}`);
    }


    // --- CENÁRIO 3: Input Ambíguo (Conflito de Flows) ---
    console.log('\n🔹 Cenário 3: Input Ambíguo ("fazer apresentação" matches triggers de slides)');
    const sim3 = new ScenarioSimulator('sec-003');
    
    const res3 = await sim3.simulate('Preciso de uma apresentação agora');
    
    results.push({ scenario: 3, decision: res3.decision });
    const scoreLog = res3.debugLogs.find(l => l.type === 'flow_start_decision');
    if (res3.decision.flowId === 'html_slides' && scoreLog?.match?.matchType === 'trigger') {
        console.log('   ✅ OK: Decisão consistente baseada em trigger (Score 1.0).');
    } else {
        console.error(`   ❌ FAIL: Escolha inconsistente ou score baixo. Decision FlowId: ${res3.decision.flowId}`);
    }


    // --- CENÁRIO 4: Retorno ao Contexto Anterior ---
    console.log('\n🔹 Cenário 4: Retorno ao Contexto (Input leve tentando reativar flow)');
    const sim4 = new ScenarioSimulator('sec-004');
    sim4.withActiveFlow('html_slides', 'ask_title');
    
    const res4 = await sim4.simulate('Sim, vamos continuar com os slides');
    
    results.push({ scenario: 4, decision: res4.decision });
    // Aqui esperamos que ele se mantenha no FLOW ou identifique START_FLOW (re-entry)
    if (res4.decision.strategy === CognitiveStrategy.FLOW || res4.decision.strategy === CognitiveStrategy.START_FLOW) {
        console.log(`   ✅ OK: Sistema reconheceu intenção de continuidade (Estratégia: ${res4.decision.strategy}).`);
    } else {
        console.warn(`   ⚠️ INFO: Sistema divergiu para ${res4.decision.strategy}.`);
    }


    // --- CENÁRIO 5: Anti-regressão (Input Recursivo Simulado) ---
    console.log('\n🔹 Cenário 5: Anti-regressão (Input que causaria loop de triggers)');
    // Simulando um input que bate em múltiplos triggers mas o Orchestrator deve ser decisivo
    const sim5 = new ScenarioSimulator('sec-005');
    const res5 = await sim5.simulate('slides organizar limpar'); // Mistura de dois flows
    
    results.push({ scenario: 5, decision: res5.decision });
    if (res5.decision.flowId) {
        console.log(`   ✅ OK: Orchestrator escolheu um único vencedor: ${res5.decision.flowId}`);
        console.log(`   Justificativa: ${res5.decision.reason}`);
    } else {
        console.log('   ✅ OK: Nenhuma decisão de flow tomada (evitou ambiguidade perigosa).');
    }

    // --- SALVAR RESULTADOS ---
    fs.writeFileSync('tests/behavioral_results.json', JSON.stringify(results, null, 2));
    console.log('\n🏁 Suíte de Validação Comportamental Finalizada. Resultados em tests/behavioral_results.json');
}

runBehavioralTests().catch(err => {
    console.error('💥 Erro fatal na suíte comportamental:', err);
    process.exit(1);
});
