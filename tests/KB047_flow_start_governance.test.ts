import { CognitiveOrchestrator, CognitiveStrategy } from '../src/core/orchestrator/CognitiveOrchestrator';
import { SessionManager } from '../src/shared/SessionManager';
import { FlowManager } from '../src/core/flow/FlowManager';
import { FlowRegistry } from '../src/core/flow/FlowRegistry';

async function runFlowStartTests() {
    console.log('🧪 Iniciando Testes de Governança de Flow Start - KB-047\n');

    const sessionId = 'test-flow-start-' + Date.now();
    const flowManager = new FlowManager();
    const orchestrator = new CognitiveOrchestrator({} as any, flowManager, null);

    // Setup Session
    const session = SessionManager.getSession(sessionId);

    // --- TESTE 1: Match por Trigger Direto ---
    console.log('Teste 1: Match por Trigger Direto ("criar slides")');
    
    // O flow "html_slides" tem o trigger "criar slides"
    const decision1 = await orchestrator.decide({
        sessionId,
        input: 'Quero criar slides para meu projeto'
    });

    if (decision1.strategy === CognitiveStrategy.START_FLOW && decision1.flowId === 'html_slides') {
        console.log('✅ OK: Flow identificado via trigger governado no Orchestrator.');
    } else {
        console.error(`❌ FAIL: Esperado START_FLOW (html_slides), obteve ${decision1.strategy} (${decision1.flowId || 'N/A'})`);
    }

    // --- TESTE 2: Match por Tags (Sistema de Pontuação) ---
    console.log('\nTeste 2: Match por Tags ("html", "apresentação")');
    
    // O flow "html_slides" tem tags ['slides', 'html', 'presentation']
    // O decideFlowStart exige no mínimo 2 tags ou o total de tags se menor que 2.
    const decision2 = await orchestrator.decide({
        sessionId,
        input: 'Preciso de uma apresentação em html'
    });

    if (decision2.strategy === CognitiveStrategy.START_FLOW && decision2.flowId === 'html_slides') {
        console.log('✅ OK: Flow identificado via tags (2 matches).');
    } else {
        console.error(`❌ FAIL: Esperado START_FLOW (html_slides), obteve ${decision2.strategy} (${decision2.flowId || 'N/A'})`);
    }

    // --- TESTE 3: Verificação de Ausência de Mini-Brain no FlowRegistry ---
    console.log('\nTeste 3: Verificação de Ausência de Mini-Brain no FlowRegistry');
    
    try {
        // @ts-ignore - matchByInput não deve mais existir
        if (typeof FlowRegistry.matchByInput === 'undefined') {
            console.log('✅ OK: matchByInput removido do FlowRegistry (Authority Centralizada).');
        } else {
            console.error('❌ FAIL: matchByInput ainda reside no FlowRegistry.');
        }
    } catch (e) {
        console.log('✅ OK: matchByInput não está acessível (Authority Centralizada).');
    }

    // --- TESTE 4: Bloqueio por Precedência (Pending Action) ---
    console.log('\nTeste 4: Bloqueio por Precedência (Pending Action > Flow Start)');
    
    const { setPendingAction } = require('../src/core/agent/PendingActionTracker');
    setPendingAction(session, { type: 'test', payload: {} });

    const decision3 = await orchestrator.decide({
        sessionId,
        input: 'criar slides'
    });

    if (decision3.strategy === CognitiveStrategy.EXECUTE_PENDING || 
        decision3.strategy === CognitiveStrategy.LLM || 
        decision3.strategy === CognitiveStrategy.CONFIRM) { 
        console.log(`✅ OK: Flow Start bloqueado por precedência (Estratégia: ${decision3.strategy}).`);
    } else if (decision3.strategy === CognitiveStrategy.START_FLOW) {
        console.error('❌ FAIL: Flow Start iniciado mesmo com Pending Action ativa.');
    } else {
         console.log(`✅ OK: Comportamento seguro: ${decision3.strategy}`);
    }

    console.log('\n🏁 Testes de Governança de Flow Start Finalizados.');
}

runFlowStartTests().catch(err => {
    console.error('💥 Erro fatal nos testes:', err);
    process.exit(1);
});
