import assert from 'node:assert/strict';
import { CognitiveOrchestrator, CognitiveStrategy } from '../core/orchestrator/CognitiveOrchestrator';
import { IntentionResolver } from '../core/agent/IntentionResolver';
import { AgentLoop } from '../engine/AgentLoop';
import { SessionManager } from '../shared/SessionManager';
import { FlowManager } from '../core/flow/FlowManager';
import { SkillRegistry } from '../engine/SkillRegistry';
import { LLMProvider, MessagePayload, ProviderResponse } from '../engine/ProviderFactory';

// ─── Tracker: instrumenta o LLM para contar chamadas ─────────────────────────
class MockLLM implements LLMProvider {
    public callCount = 0;
    public lastMessages: MessagePayload[] = [];
    private readonly reply: string;

    constructor(reply = 'Olá! Como posso ajudar hoje?') {
        this.reply = reply;
    }

    async generate(messages: MessagePayload[]): Promise<ProviderResponse> {
        this.callCount++;
        this.lastMessages = messages;
        return { final_answer: this.reply };
    }
    async embed() { return []; }
}

// ─── Fixture de memória mínima ────────────────────────────────────────────────
const mockMemory = {
    searchByContent: () => [],
    saveMessage: () => {},
    retrieveWithTraversal: async () => [],
    getIdentityNodes: async () => [],
    getProjectNodes: () => [],
    getConversationHistory: () => [],
    saveProjectNode: async () => {},
    indexCodeNode: async () => {},
    setActiveCodeFiles: () => {},
    saveExecutionFix: () => {},
    learn: async () => {},
    saveUserMemory: async () => 'mock-id',
    upsertSkillGraph: async () => {},
    removeSkillGraph: () => {},
    cleanupOrphanSkillNodes: () => 0
};

// ─── Helper: monta orchestrator + loop com wiring correto ────────────────────
function buildFixture(llm: MockLLM) {
    const flowManager = new FlowManager();
    const orchestrator = new CognitiveOrchestrator(mockMemory as any, flowManager);
    const loop = new AgentLoop(llm, new SkillRegistry());
    // Injetar orchestrator no loop (KB-045 pattern: setOrchestrator)
    if (typeof (loop as any).setOrchestrator === 'function') {
        (loop as any).setOrchestrator(orchestrator);
    }
    return { orchestrator, loop };
}

// ─── Helper: executa loop com a decisão do orchestrator passada via policy ───
async function runWithOrchestration(
    loop: AgentLoop,
    orchestrator: CognitiveOrchestrator,
    sessionId: string,
    input: string
) {
    const intentResult = IntentionResolver.resolve(input);
    const decision = await orchestrator.decide({
        sessionId,
        input,
        intent: { ...intentResult, mode: 'EXPLORATION' } as any
    });
    const policy = { orchestrationResult: decision };
    const result = await loop.run([{ role: 'user', content: input }], policy as any);
    return { intentResult, decision, result };
}

// ─── Suíte ───────────────────────────────────────────────────────────────────
async function runTests() {
    console.log('🚀 Running KB-049 Small Talk Integration Tests...');

    // ─── Cenário 1: Flags corretas do Orchestrator ───────────────────────────
    await SessionManager.runWithSession('st-int-1', async () => {
        console.log('\n[S1] Orchestrator → skipPlanning + skipToolLoop para SMALL_TALK');
        const llm = new MockLLM();
        const { orchestrator, loop } = buildFixture(llm);
        const { intentResult, decision, result } = await runWithOrchestration(
            loop, orchestrator, 'st-int-1', 'Oi, tudo bem?'
        );

        console.log(`  intent: ${intentResult.type}`);
        console.log(`  strategy: ${decision.strategy}`);
        console.log(`  skipPlanning: ${decision.skipPlanning}`);
        console.log(`  skipToolLoop: ${decision.skipToolLoop}`);
        console.log(`  reason: ${decision.reason}`);
        console.log(`  answer: ${result.answer}`);
        console.log(`  llm calls: ${llm.callCount}`);

        assert.equal(intentResult.type, 'SMALL_TALK', 'intent deve ser SMALL_TALK');
        assert.equal(decision.strategy, CognitiveStrategy.LLM, 'strategy deve ser LLM');
        assert.equal(decision.skipPlanning, true, 'skipPlanning deve ser true');
        assert.equal(decision.skipToolLoop, true, 'skipToolLoop deve ser true');
        assert.equal(decision.reason, 'small_talk_fast_path', 'reason deve ser small_talk_fast_path');
        assert.ok(result.answer && result.answer.length > 0, 'deve retornar resposta não vazia');
        // Direct path = exatamente 1 chamada LLM (sem planejamento que gera chamadas extras)
        assert.equal(llm.callCount, 1, 'loop direto deve chamar LLM exatamente uma vez');
        console.log('  ✅ S1 PASS');
    });

    // ─── Cenário 2: REAL_TOOLS_ONLY não bloqueia SMALL_TALK ────────────────
    await SessionManager.runWithSession('st-int-2', async () => {
        console.log('\n[S2] REAL_TOOLS_ONLY não bloqueia SMALL_TALK ("Oi")');
        const llm = new MockLLM('Oi! Estou bem, obrigado!');
        const { orchestrator, loop } = buildFixture(llm);
        let threw = false;
        let answer = '';
        try {
            const { result } = await runWithOrchestration(loop, orchestrator, 'st-int-2', 'Oi');
            answer = result.answer;
        } catch (e) {
            threw = true;
            console.log(`  ERRO: ${(e as Error).message}`);
        }
        console.log(`  lançou erro: ${threw}`);
        console.log(`  answer: ${answer}`);
        assert.equal(threw, false, 'REAL_TOOLS_ONLY não deve bloquear SMALL_TALK');
        assert.ok(answer.length > 0, 'deve retornar resposta não vazia');
        console.log('  ✅ S2 PASS');
    });

    // ─── Cenário 3: Precedência — "oi, você lembra de mim?" → MEMORY_CHECK ─
    await SessionManager.runWithSession('st-int-3', async () => {
        console.log('\n[S3] Precedência MEMORY > SMALL_TALK: "oi, você lembra de mim?"');
        const llm = new MockLLM();
        const { orchestrator, loop } = buildFixture(llm);
        const { intentResult } = await runWithOrchestration(
            loop, orchestrator, 'st-int-3', 'oi, você lembra de mim?'
        );
        console.log(`  intent: ${intentResult.type}`);
        assert.notEqual(intentResult.type, 'SMALL_TALK', 'NÃO deve ser SMALL_TALK');
        assert.ok(
            intentResult.type === 'MEMORY_CHECK' || intentResult.type === 'MEMORY_QUERY',
            `deve ser MEMORY, obteve: ${intentResult.type}`
        );
        console.log('  ✅ S3 PASS');
    });

    // ─── Cenário 4: Greeting composto com pedido → não é SMALL_TALK ────────
    await SessionManager.runWithSession('st-int-4', async () => {
        console.log('\n[S4] Greeting composto com pedido: "oi, você pode me ajudar?"');
        const llm = new MockLLM();
        const { orchestrator, loop } = buildFixture(llm);
        const { intentResult, decision } = await runWithOrchestration(
            loop, orchestrator, 'st-int-4', 'oi, você pode me ajudar?'
        );
        console.log(`  intent: ${intentResult.type}`);
        console.log(`  skipPlanning: ${decision.skipPlanning}`);
        console.log(`  skipToolLoop: ${decision.skipToolLoop}`);
        assert.notEqual(intentResult.type, 'SMALL_TALK', '"oi, você pode me ajudar?" NÃO deve ser SMALL_TALK');
        // Não deve ter o fast-path de small talk
        assert.notEqual(decision.reason, 'small_talk_fast_path', 'reason não deve ser small_talk_fast_path');
        console.log('  ✅ S4 PASS');
    });

    console.log('\n✅ KB-049 Integration Tests Passed!');
}

runTests().catch(err => {
    console.error('\n❌ KB-049 Integration Tests Failed:');
    console.error(err);
    process.exit(1);
});
