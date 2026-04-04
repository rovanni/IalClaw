import { SessionManager } from '../src/shared/SessionManager';
import { FlowManager } from '../src/core/flow/FlowManager';
import { FlowRegistry } from '../src/core/flow/FlowRegistry';
import { Flow, FlowStep } from '../src/core/flow/types';
import { CognitiveOrchestrator, CognitiveStrategy } from '../src/core/orchestrator/CognitiveOrchestrator';

class MultiStepFlow implements Flow {
    public id = 'multi-step';
    public steps: FlowStep[] = [
        {
            id: 'step1',
            prompt: () => 'Step 1',
            validate: (input) => input === 'ok',
            process: () => { }
        },
        {
            id: 'step2',
            prompt: () => 'Step 2',
            validate: () => true,
            process: () => { }
        }
    ];
    public async onComplete() { return { action: 'done' }; }
}

async function runTests() {
    console.log('🧪 Final Cognitive Flow Integration Tests...\n');

    const flowManager = new FlowManager();
    const orchestrator = new CognitiveOrchestrator({} as any, flowManager, null);

    // Test 1: Persistence
    console.log('Test 1: Persistence survival');
    const sessionId = 'final-test-session';
    const session = SessionManager.getSession(sessionId);
    flowManager.startFlow(new MultiStepFlow(), {}, 'slide');
    session.flow_state = flowManager.getState()!;
    SessionManager.resetVolatileState(sessionId);
    if (session.flow_state?.flowId === 'multi-step') {
        console.log('✅ OK: Flow state survived reset.');
    } else {
        console.error('❌ FAIL: Flow state lost.');
    }

    // Test 2: Precedence (Reactive > Flow)
    console.log('\nTest 2: Precedence (Reactive > Flow)');
    session.reactive_state = { hasFailure: true };
    const decision = await orchestrator.decide({ sessionId, input: 'test' });
    if (decision.strategy !== CognitiveStrategy.FLOW) {
        console.log('✅ OK: Reactive recovery inhibited FLOW strategy.');
    } else {
        console.error('❌ FAIL: FLOW strategy prioritized over Reactive.');
    }

    // Test 3: Contextual Escape
    console.log('\nTest 3: Contextual Escape');
    flowManager.startFlow(new MultiStepFlow(), {}, 'slide');
    const res1 = await flowManager.handleInput('Dúvida sobre o slide');
    if (!res1.exited && flowManager.isInFlow()) {
        console.log('✅ OK: Related question allowed.');
    } else {
        console.error('❌ FAIL: Related question blocked.');
    }

    const res2 = await flowManager.handleInput('Sair agora');
    if (res2.exited && !flowManager.isInFlow()) {
        console.log('✅ OK: Unrelated escape worked.');
    } else {
        console.error('❌ FAIL: Escape failed.');
    }

    console.log('\n🏁 All Tests Finished.');
}

runTests().catch(console.error);
