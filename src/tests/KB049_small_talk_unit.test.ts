import assert from 'node:assert/strict';
import { IntentionResolver } from '../core/agent/IntentionResolver';

async function runTests() {
    console.log('🚀 Running KB-049 Small Talk Unit Tests...');

    const scenarios = [
        // --- SMALL_TALK corretos ---
        { input: 'Oi', expected: 'SMALL_TALK' },
        { input: 'Tudo bem?', expected: 'SMALL_TALK' },
        { input: 'Bom dia!', expected: 'SMALL_TALK' },
        { input: 'e aí beleza?', expected: 'SMALL_TALK' },
        { input: 'vlw', expected: 'SMALL_TALK' },
        { input: 'obrigado', expected: 'SMALL_TALK' },
        { input: '😁', expected: 'SMALL_TALK' },
        // --- NÃO deve ser SMALL_TALK (anti-overreach MEMORY_STORE) ---
        { input: 'tudo bem, guarde isso', expected: '!SMALL_TALK' },
        { input: 'valeu, mas lembre disso', expected: '!SMALL_TALK' },
        { input: 'obg, registre isso', expected: '!SMALL_TALK' },
        { input: 'oi! anote isso', expected: '!SMALL_TALK' },
        // --- NÃO deve ser SMALL_TALK (task com saudação inline) ---
        { input: 'Oi, me ajuda a criar um arquivo?', expected: '!SMALL_TALK' },
        // --- QUESTION e META não afetados ---
        { input: 'Pode apagar o arquivo teste.txt?', expected: 'QUESTION' },
        { input: 'Como você funciona?', expected: 'META' }
    ];

    for (const { input, expected } of scenarios) {
        const result = IntentionResolver.resolve(input);
        console.log(`Checking "${input}": Expected ${expected}, Got ${result.type}`);
        
        if (expected === '!SMALL_TALK') {
            // Anti-overreach: garantir que MEMORY_STORE/MEMORY_QUERY não seja capturado como SMALL_TALK
            assert.notEqual(result.type, 'SMALL_TALK', `"${input}" não deve ser SMALL_TALK`);
        } else if (expected === 'SMALL_TALK' || expected === 'TASK' || expected === 'META') {
            assert.equal(result.type, expected);
        } else {
            // Outros tipos podem variar (ex: QUESTION vs TASK), mas SMALL_TALK deve ser preciso
            assert.notEqual(result.type, 'SMALL_TALK');
        }
    }

    console.log('✅ Unit Tests Passed!');
}

runTests().catch(err => {
    console.error('❌ Unit Tests Failed:');
    console.error(err);
    process.exit(1);
});
