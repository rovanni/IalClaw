import assert from 'node:assert/strict';
import { FlowRegistry } from './src/core/flow/FlowRegistry';
import { decideFlowStart } from './src/core/orchestrator/decisions/flow/decideFlowStart';

// Mock flows for testing
FlowRegistry.registerDefinition({
    id: 'registry_test_flow_a',
    flowClass: class {} as any,
    tags: ['registry', 'alpha'],
    triggers: ['registrar alpha flow'],
    priority: 3,
    description: 'Flow de teste alpha'
});

const decision = decideFlowStart({
    sessionId: 'test-session',
    input: 'pode registrar alpha flow para mim?',
    availableFlows: FlowRegistry.listDefinitions()
});

console.log('Decision:', JSON.stringify(decision, null, 2));
assert.equal(decision.flowId, 'registry_test_flow_a');
console.log('Success!');
