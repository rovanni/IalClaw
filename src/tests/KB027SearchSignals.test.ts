/**
 * KB-027 FASE 4: Testes de SearchSignals
 * Valida que signals são emitidos durante operações de Search
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine, SearchDocument } from '../search/pipeline/searchEngine';
import { CognitiveOrchestrator } from '../core/orchestrator/CognitiveOrchestrator';

test('SearchSignals - KB-027 FASE 4', async (suite) => {
    const testSessionId = 'test-session-kb027';

    // Helper para criar mock de orchestrator
    const createMockOrchestrator = () => {
        const signals: any[] = [];
        return {
            _observedSearchSignals: signals,
            ingestSearchSignal(sessionId: string, signal: any) {
                signals.push(signal);
            },
            getLastSearchSignal() {
                return signals[signals.length - 1];
            },
            clearSearchSignals() {
                signals.length = 0;
            },
            decideQueryExpansion: () => undefined,
            decideSearchWeights: () => undefined,
            decideGraphExpansion: () => undefined,
            decideReranking: () => undefined,
            decideSearchFallbackStrategy: () => undefined,
        };
    };

    await suite.test('SEARCH_QUERY signal emitted on query', async () => {
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const orchestrator = createMockOrchestrator() as any;
        engine.setOrchestrator(orchestrator);

        const docs: SearchDocument[] = [
            {
                id: 'doc1',
                title: 'Test Document',
                content: 'Content about testing and queries',
                metadata: {}
            }
        ];
        await engine.indexDocuments(docs);

        const results = await engine.search('test', {
            expandSynonyms: true,
            sessionId: testSessionId,
            limit: 10
        });

        const signal = orchestrator.getLastSearchSignal();
        assert.ok(signal, 'signal should be present');
        assert.equal(signal.type, 'SEARCH_QUERY', 'signal type should be SEARCH_QUERY');
        assert.ok(results, 'search should return results');
    });

    await suite.test('SEARCH_SCORING signal emitted after scoring', async () => {
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const orchestrator = createMockOrchestrator() as any;
        engine.setOrchestrator(orchestrator);

        const docs: SearchDocument[] = [
            {
                id: 'doc1',
                title: 'Scoring Test',
                content: 'Test content for scoring',
                metadata: {}
            }
        ];
        await engine.indexDocuments(docs);

        const results = await engine.search('test', {
            expandSynonyms: false,
            sessionId: testSessionId,
            limit: 10
        });

        const signals = orchestrator._observedSearchSignals;
        const scoringSignal = signals.find((s: any) => s.type === 'SEARCH_SCORING');
        
        assert.ok(scoringSignal, 'SEARCH_SCORING signal should be present');
        assert.ok(scoringSignal.weights, 'signal should have weights');
    });

    await suite.test('Signals cleared correctly', async () => {
        const engine = new SearchEngine();
        const orchestrator = createMockOrchestrator() as any;
        engine.setOrchestrator(orchestrator);

        const docs: SearchDocument[] = [
            { id: 'doc1', title: 'Test', content: 'Test content', metadata: {} }
        ];
        await engine.indexDocuments(docs);

        await engine.search('test', { sessionId: testSessionId });
        assert.ok(orchestrator.getLastSearchSignal(), 'signal should exist after search');

        orchestrator.clearSearchSignals();
        assert.equal(orchestrator.getLastSearchSignal(), undefined, 'signal should be cleared');
    });
});
