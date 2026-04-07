import { IntentionResolver } from './src/core/agent/IntentionResolver';
import { createLogger } from './src/shared/AppLogger';

// Mock logger since IntentionResolver uses it
(IntentionResolver as any).logger = createLogger('DebugIntent');

const tests = [
    'o que voce tem na sua memoria sobre mim?',
    'isso esta na sua memoria?',
    'que voce sabe sobre meu saldo?',
    'esquece'
];

console.log('--- INTENT RESOLUTION DEBUG ---');
for (const t of tests) {
    const match = IntentionResolver.resolve(t);
    console.log(`Input: "${t}"`);
    console.log(`Type: ${match.type}`);
    console.log(`Confidence: ${match.confidence}`);
    console.log('-----------------------------');
}
