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
            validate: (input) => input === 'ok', // Exige 'ok' para passar
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
    console.log('🧪 Starting Refined Multi-step Flow Continuity Tests...\n');

    const flowManager = new FlowManager();
    const orchestrator = new CognitiveOrchestrator({} as any, flowManager, null);

    // Test 4: Intent Contextual Escape (Multi-step)
    console.log('Test 4: Intent Contextual Escape');
    flowManager.startFlow(new MultiStepFlow(), {}, 'slide'); // topic = 'slide'

    // Pergunta relacionada que NÃO é um input válido para o step (validate retorna false)
    const res1 = await flowManager.handleInput('Como eu faço esse slide?');
    if (!res1.exited && flowManager.isInFlow()) {
        console.log('✅ OK: Related question allowed (retried step).');
    } else {
        console.error('❌ FAIL: Related question cancelled or completed flow unexpectedly.');
        console.log('Result:', JSON.stringify(res1));
        console.log('isInFlow:', flowManager.isInFlow());
    }

    const res2 = await flowManager.handleInput('Parar tudo agora');
    if (res2.exited && !flowManager.isInFlow()) {
        console.log('✅ OK: Unrelated escape cancelled flow.');
    } else {
        console.error('❌ FAIL: Escape failed to cancel flow.');
    }

    console.log('\n🏁 Tests Finished.');
}

runTests().catch(console.error);
