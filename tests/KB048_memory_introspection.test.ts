import assert from 'node:assert/strict';
import { IntentionResolver } from '../src/core/agent/IntentionResolver';
import { CognitiveOrchestrator, CognitiveStrategy } from '../src/core/orchestrator/CognitiveOrchestrator';
import { FlowManager } from '../src/core/flow/FlowManager';
import { SessionManager } from '../src/shared/SessionManager';

async function runKB048Tests() {
    console.log('🧪 Iniciando Testes de Introspecção de Memória - KB-048\n');

    const sessionId = 'test-kb048-' + Date.now();
    
    // --- PARTE 1: IntentionResolver ---
    console.log('--- PARTE 1: IntentionResolver ---');
    
    const checkInputs = [
        'isso está na sua memória?',
        'você tem isso registrado?',
        'esta guardado na memoria?',
        'voce gravou isso?',
        'esta armazenado?'
    ];
    for (const input of checkInputs) {
        const match = IntentionResolver.resolve(input);
        if (match.type !== 'MEMORY_CHECK') {
            console.error(`❌ FAIL: "${input}" detectado como ${match.type}, esperado MEMORY_CHECK`);
        }
        assert.equal(match.type, 'MEMORY_CHECK', `Falha em: ${input}`);
        console.log(`✅ OK: Detectado MEMORY_CHECK para "${input}"`);
    }

    const queryInputs = [
        'o que você sabe sobre mim?',
        'o que voce lembra do meu saldo?',
        'quais informacoes voce tem sobre o paxg?',
        'me diga o que voce sabe sobre meu projeto',
        'e do pax gold?',
        'e sobre o paxg?',
        'e quanto a minha carteira?'
    ];
    for (const input of queryInputs) {
        const match = IntentionResolver.resolve(input);
        assert.equal(match.type, 'MEMORY_QUERY', `Falha ao detectar MEMORY_QUERY para: ${input}`);
        console.log(`✅ OK: Detectado MEMORY_QUERY para "${input}"`);
    }

    const storeInputs = [
        'guarde que meu aniversário é dia 10',
        'registre que eu gosto de azul',
        'anote isso: o projeto é em node',
        'lembre-se que meu nome é lucas'
    ];
    for (const input of storeInputs) {
        const match = IntentionResolver.resolve(input);
        assert.equal(match.type, 'MEMORY_STORE', `Falha ao detectar MEMORY_STORE para: ${input}`);
        console.log(`✅ OK: Detectado MEMORY_STORE para "${input}"`);
    }

    // --- PARTE 2: CognitiveOrchestrator Routing ---
    console.log('\n--- PARTE 2: CognitiveOrchestrator Routing ---');

    const mockMemory = {
        searchByContent: async () => [{ id: 'mem1', content: 'Saldo: 0.38 PAXG', score: 0.95 }],
        saveUserMemory: async () => 'new_mem_123'
    } as any;
    
    const flowManager = new FlowManager();
    const orchestrator = new CognitiveOrchestrator(mockMemory, flowManager);

    // Test Query Route
    console.log('Teste: Roteamento de MEMORY_QUERY');
    const decision1 = await orchestrator.decide({
        sessionId,
        input: 'o que você sabe sobre meu paxg?'
    });

    assert.equal(decision1.strategy, CognitiveStrategy.LLM);
    assert.equal(decision1.reason, 'memory_introspection_hit');
    assert.equal(decision1.usedInputGap, false); // Introspeção não consome gap
    assert.ok(decision1.memoryHits && decision1.memoryHits.length > 0);
    console.log('✅ OK: MEMORY_QUERY roteado para LLM com hits de memória.');

    // Test Store Route
    console.log('Teste: Roteamento de MEMORY_STORE');
    const decision2 = await orchestrator.decide({
        sessionId,
        input: 'guarde que meu aniversário é dia 10'
    });

    assert.equal(decision2.strategy, CognitiveStrategy.LLM);
    assert.equal(decision2.reason, 'memory_store_executed');
    assert.equal(decision2.usedInputGap, false);
    console.log('✅ OK: MEMORY_STORE executado e roteado para LLM para confirmação.');

    // --- PARTE 3: Governance (Single Brain) ---
    console.log('\n--- PARTE 3: Governança (Single Brain) ---');
    
    const session = SessionManager.getSession(sessionId);
    session.last_input_gap = { capability: 'test', reason: 'gap' } as any;

    // A introspeção NÃO deve consumir o gap (é meta-cognitiva)
    await orchestrator.decide({
        sessionId,
        input: 'o que voce sabe sobre mim?'
    });
    assert.ok(session.last_input_gap, 'ERRO: Gap consumido por introspeção (deve ser preservado)');
    console.log('✅ OK: Input gap preservado durante introspeção.');

    // Uma tarefa normal DEVE consumir o gap via consolidateAndReturn
    await orchestrator.decide({
        sessionId,
        input: 'ajuda com codigo'
    });
    assert.equal(session.last_input_gap, undefined, 'ERRO: Gap NÃO consumido por tarefa normal');
    console.log('✅ OK: Input gap consumido corretamente no Final Gate.');

    console.log('\n🏁 Todos os testes KB-048 passaram com sucesso!');
}

runKB048Tests().catch(err => {
    console.error('\n❌ Falha nos testes KB-048:');
    console.error(err);
    process.exit(1);
});
