import { IntentionResolver } from './src/core/agent/IntentionResolver';

const testInput = 'o que voce tem na sua memoria sobre mim?';
const result = IntentionResolver.resolve(testInput);

console.log(`Input: ${testInput}`);
console.log(`Resolved Intent: ${result.type}`);
console.log(`Confidence: ${result.confidence}`);
