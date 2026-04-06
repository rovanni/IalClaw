import { CognitiveOrchestrator, CognitiveStrategy } from '../src/core/orchestrator/CognitiveOrchestrator';
import { SessionManager } from '../src/shared/SessionManager';
import { FlowManager } from '../src/core/flow/FlowManager';
import { setPendingAction, clearPendingAction } from '../src/core/agent/PendingActionTracker';

async function runStabilizationTests() {
    console.log('🧪 Iniciando Testes de Estabilização - KB-046 (FINAL)\n');

    const sessionId = 'test-session-' + Date.now();
    const flowManager = new FlowManager();
    const orchestrator = new CognitiveOrchestrator({} as any, flowManager, null);

    // Setup Session
    const session = SessionManager.getSession(sessionId);

    // --- TESTE 1: Pending Action vs Flow Start ---
    console.log('Teste 1: Pending Action vs Flow Start');
    
    setPendingAction(session, {
        type: 'install_skill',
        payload: {
            skillName: 'test-skill'
        }
    });

    const decision1 = await orchestrator.decide({
        sessionId,
        input: 'Sim'
    });

    if (decision1.strategy === CognitiveStrategy.EXECUTE_PENDING) {
        console.log('✅ OK: Pending Action venceu Flow Start.');
    } else {
        console.error(`❌ FAIL: Esperado EXECUTE_PENDING, obteve ${decision1.strategy}`);
    }

    // --- TESTE 2: Flow Escape (Topic Shift) ---
    console.log('\nTeste 2: Flow Escape (Topic Shift)');
    
    clearPendingAction(session);
    session.flow_state = { 
        flowId: 'test-flow', 
        topic: 'assunto-vendas', 
        stepIndex: 0,
        retryCount: 0,
        context: {},
        confidence: 0.9
    };

    // Input de escape explícito (STOP intent)
    const decision2 = await orchestrator.decide({
        sessionId,
        input: 'CANCELAR TUDO AGORA'
    });

    if (decision2.strategy === CognitiveStrategy.INTERRUPT_FLOW && decision2.interruptionReason === 'user_interruption') {
        console.log('✅ OK: Flow interrompido por mudança de tópico detectada.');
    } else {
        console.error(`❌ FAIL: Esperado INTERRUPT_FLOW, obteve ${decision2.strategy}`);
    }

    // --- TESTE 3: Consumo de Input Gap (PRESERVAÇÃO) ---
    console.log('\nTeste 3: Consumo de Input Gap (PRESERVAÇÃO)');
    
    session.flow_state = undefined;
    
    session.last_input_gap = {
        capability: 'search',
        reason: 'missing_query'
    };

    // Input que é INFORMATIVE e portanto não deve consumir o gap.
    const decision3 = await orchestrator.decide({
        sessionId,
        input: 'Explique brevemente como uma IA funciona'
    });

    if (session.last_input_gap) {
        console.log('✅ OK: Input Gap PRESERVADO (decisão INFORMATIVE/LLM direto).');
    } else {
        console.error('❌ FAIL: Input Gap foi consumido indevidamente.');
    }

    // --- TESTE 3.1: Consumo de Input Gap (USO EFETIVO) ---
    console.log('\nTeste 3.1: Consumo de Input Gap (USO EFETIVO)');
    const decision4 = await orchestrator.decide({
        sessionId,
        input: 'Pesquise sobre a evolução da IA nos últimos 2 anos'
    });

    if (!session.last_input_gap) {
        console.log('✅ OK: Input Gap CONSUMIDO (chegou no uso efetivo TOOL/CONFIRM).');
    } else {
        console.error(`❌ FAIL: Input Gap não consumido. Estratégia: ${decision4.strategy}.`);
    }

    // --- TESTE 4: Hierarquia de Precedência (Recovery > Flow) ---
    console.log('\nTeste 4: Hierarquia de Precedência (Recovery > Flow)');
    
    session.reactive_state = { hasFailure: true, attempt: 1, type: 'execution_failed', error: 'erro fatal', context: { capability: 'tool' } };
    session.flow_state = { 
        flowId: 'test-flow', 
        topic: 'topico', 
        stepIndex: 0,
        retryCount: 0,
        context: {},
        confidence: 0.9
    };

    const decision5 = await orchestrator.decide({
        sessionId,
        input: 'Tentar novamente'
    });

    if (decision5.strategy === CognitiveStrategy.CONFIRM && decision5.reason === 'reactive_recovery_needed') {
        console.log('✅ OK: Recovery venceu Flow.');
    } else {
        console.error(`❌ FAIL: Esperado CONFIRM (recovery), obteve ${decision5.strategy} (${decision5.reason})`);
    }

    console.log('\n🏁 Testes de Estabilização Finalizados.');
}

runStabilizationTests().catch(err => {
    console.error('💥 Erro fatal nos testes:', err);
    process.exit(1);
});
