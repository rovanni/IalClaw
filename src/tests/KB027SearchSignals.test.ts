/**
 * KB-027 FASE 4: Testes de SearchSignals
 * Valida que signals são emitidos durante operações de Search
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine, SearchDocument } from '../search/pipeline/searchEngine';
import { SessionManager } from '../shared/SessionManager';

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
        assert.equal(signal.originalQuery, 'test', 'originalQuery should match the query string');
        assert.ok(Array.isArray(signal.expandedTerms), 'expandedTerms should be an array');
        assert.equal(signal.graphExpansion, false, 'graphExpansion should be false for synonym-only expansion');
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
        await engine.indexDocuments(docs, testSessionId);

        const results = await engine.search('test', {
            expandSynonyms: false,
            sessionId: testSessionId,
            limit: 10
        });

        const signals = orchestrator._observedSearchSignals;
        const scoringSignal = signals.find((s: any) => s.type === 'SEARCH_SCORING');
        
        assert.ok(scoringSignal, 'SEARCH_SCORING signal should be present');
        assert.ok(scoringSignal.weights, 'signal should have weights');
        assert.equal(typeof scoringSignal.weights.titleMatch, 'number', 'weights.titleMatch should be a number');
        assert.equal(typeof scoringSignal.weights.contentMatch, 'number', 'weights.contentMatch should be a number');
        assert.equal(typeof scoringSignal.weights.tagMatch, 'number', 'weights.tagMatch should be a number');
        assert.equal(scoringSignal.semanticBoost, 1.0, 'semanticBoost should be 1.0');
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

    await suite.test('indexDocuments stores document cache in session scope when sessionId is provided', async () => {
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const docs: SearchDocument[] = [
            {
                id: 'doc-session-cache',
                title: 'Session Cache Test',
                content: 'Document stored in session-scoped cache',
                metadata: { scope: 'session' }
            }
        ];

        await engine.indexDocuments(docs, testSessionId);

        const session = SessionManager.getSession(testSessionId);
        const cachedDoc = session.search_cache?.documentCache.get('doc-session-cache');
        const otherSession = SessionManager.getSession('test-session-kb027-other');

        assert.ok(session.search_cache, 'search_cache should be initialized for the session');
        assert.ok(cachedDoc, 'document should be stored in session-scoped cache');
        assert.equal(cachedDoc?.title, 'Session Cache Test');
        assert.equal(otherSession.search_cache?.documentCache.get('doc-session-cache'), undefined, 'cache should not leak to another session');
    });

    await suite.test('inverted index does not leak documents between sessions', async () => {
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const docs: SearchDocument[] = [
            {
                id: 'doc-index-session-1',
                title: 'Only Session One',
                content: 'unique term sessiononeonly',
                metadata: {}
            }
        ];

        await engine.indexDocuments(docs, 'kb027-session-one');

        const sessionOneResults = await engine.search('sessiononeonly', {
            sessionId: 'kb027-session-one',
            expandSynonyms: false,
            useRerank: false,
            useLLM: false
        });

        const sessionTwoResults = await engine.search('sessiononeonly', {
            sessionId: 'kb027-session-two',
            expandSynonyms: false,
            useRerank: false,
            useLLM: false
        });

        assert.ok(sessionOneResults.length > 0, 'session one should find indexed document');
        assert.equal(sessionTwoResults.length, 0, 'session two should not see session one index data');
    });

    await suite.test('search engines do not share semantic graph bridge singleton in main path', async () => {
        const engineOne = new SearchEngine({ useGraphExpansion: false });
        const engineTwo = new SearchEngine({ useGraphExpansion: false });

        assert.notEqual(engineOne.getGraphBridge(), engineTwo.getGraphBridge(), 'each SearchEngine should own its graph bridge instance');
    });

    await suite.test('autotagger cache is scoped by session', async () => {
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const docs: SearchDocument[] = [
            {
                id: 'doc-autotagger-session',
                title: 'AutoTagger Session Scope',
                content: 'cache validation for autotagger session scope',
                metadata: {}
            }
        ];

        await engine.indexDocuments(docs, 'kb027-autotagger-one');

        const sessionOne = SessionManager.getSession('kb027-autotagger-one');
        const sessionTwo = SessionManager.getSession('kb027-autotagger-two');

        assert.ok((sessionOne.search_cache?.autoTaggerCache.size ?? 0) > 0, 'session one should have autotagger cache entries');
        assert.equal(sessionTwo.search_cache?.autoTaggerCache.size ?? 0, 0, 'session two should not receive autotagger cache entries');
    });

    await suite.test('SEARCH_RERANKER signal emitted after LLM reranking', async () => {
        // LlmReranker criado com enabled=false: retorna scores dummy sem chamar LLM real
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const orchestrator = createMockOrchestrator() as any;
        engine.setOrchestrator(orchestrator);

        const docs: SearchDocument[] = [
            {
                id: 'rerank-doc-1',
                title: 'First Rerank Document',
                content: 'rerank test content alpha',
                metadata: {}
            },
            {
                id: 'rerank-doc-2',
                title: 'Second Rerank Document',
                content: 'rerank test content beta',
                metadata: {}
            }
        ];
        await engine.indexDocuments(docs, testSessionId);

        // useRerank: true na busca força entrada no bloco de reranking;
        // LlmReranker.enabled=false retorna scores dummy sem LLM
        await engine.search('rerank', {
            useRerank: true,
            expandSynonyms: false,
            sessionId: testSessionId,
            limit: 10
        });

        const signals = orchestrator._observedSearchSignals;
        const rerankerSignal = signals.find((s: any) => s.type === 'SEARCH_RERANKER');

        assert.ok(rerankerSignal, 'SEARCH_RERANKER signal should be present');
        assert.equal(rerankerSignal.shouldRerank, true, 'shouldRerank should be true');
        assert.equal(typeof rerankerSignal.confidence, 'number', 'confidence should be a number');
        assert.ok(rerankerSignal.confidence > 0, 'confidence should be positive');
    });

    await suite.test('SEARCH_FALLBACK signal emitted when graph expansion fails', async () => {
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        // Mock de graphBridge que está habilitado mas falha na expansão
        const mockThrowingGraphBridge = {
            isEnabled: () => true,
            expandWithGraph: async () => {
                throw new Error('Graph DB unavailable in test');
            },
            syncDocumentRelations: async () => {},
            calculateGraphScore: () => 0,
            clearExpansionCache: () => {},
            clearEnrichmentCache: () => {},
            getStats: () => ({ expansionCacheSize: 0, enrichmentCacheSize: 0 })
        };
        (engine as any).graphBridge = mockThrowingGraphBridge;

        // Orchestrator force-habilita expansão e define estratégia de fallback explícita
        const signals: any[] = [];
        const orchestratorWithGraph = {
            _observedSearchSignals: signals,
            ingestSearchSignal(_sessionId: string, signal: any) {
                signals.push(signal);
            },
            getLastSearchSignal() {
                return signals[signals.length - 1];
            },
            decideQueryExpansion: () => undefined,
            decideSearchWeights: () => undefined,
            decideGraphExpansion: () => ({ enabled: true, maxTerms: 5, boost: 0.1 }),
            decideReranking: () => undefined,
            decideSearchFallbackStrategy: (_sessionId: string, _component: string) => 'warn_and_continue' as const
        };
        engine.setOrchestrator(orchestratorWithGraph as any);

        const docs: SearchDocument[] = [
            {
                id: 'fallback-doc-1',
                title: 'Fallback Test Document',
                content: 'fallback expansion failure test',
                metadata: {}
            }
        ];
        await engine.indexDocuments(docs, testSessionId);

        // Busca deve continuar mesmo com falha no grafo (warn_and_continue)
        await engine.search('fallback', {
            expandSynonyms: false,
            sessionId: testSessionId,
            limit: 10
        });

        const fallbackSignal = signals.find((s: any) => s.type === 'SEARCH_FALLBACK');

        assert.ok(fallbackSignal, 'SEARCH_FALLBACK signal should be present');
        assert.equal(fallbackSignal.offendingComponent, 'expansion', 'offendingComponent should be expansion');
        assert.equal(fallbackSignal.fallbackStrategy, 'warn_and_continue', 'fallbackStrategy should match orchestrator decision');
        assert.ok(typeof fallbackSignal.errorSummary === 'string' && fallbackSignal.errorSummary.length > 0, 'errorSummary should be a non-empty string');
    });
});
