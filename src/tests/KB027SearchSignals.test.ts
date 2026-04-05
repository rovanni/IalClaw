/**
 * KB-027 FASE 4: Testes de SearchSignals
 * Valida que signals são emitidos durante operações de Search
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine, SearchDocument } from '../search/pipeline/searchEngine';
import { DEFAULT_WEIGHTS } from '../search/ranking/scorer';
import { SessionManager } from '../shared/SessionManager';

test('SearchSignals - KB-027 FASE 4', async (suite) => {
    let sessionCounter = 0;

    const createTestSessionId = (label: string) => `${label}-${++sessionCounter}`;

    // Helper para criar mock de orchestrator
    const createMockOrchestrator = (overrides: Record<string, any> = {}) => {
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
            ...overrides,
        };
    };

    const getSignalsByType = (orchestrator: { _observedSearchSignals: any[] }, type: string) =>
        orchestrator._observedSearchSignals.filter((signal: any) => signal.type === type);

    await suite.test('SEARCH_QUERY signal emitted on query', async () => {
        const testSessionId = createTestSessionId('search-query');
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
        const testSessionId = createTestSessionId('search-scoring');
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
        const testSessionId = createTestSessionId('signals-cleared');
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
        const testSessionId = createTestSessionId('session-cache');
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
        const otherSession = SessionManager.getSession(createTestSessionId('session-cache-other'));

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
        const testSessionId = createTestSessionId('reranker-signal');
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
        const testSessionId = createTestSessionId('fallback-signal');
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

    await suite.test('Safe Mode respects orchestrator override and local fallback for query expansion', async () => {
        const overrideSessionId = createTestSessionId('query-override');
        const fallbackDisabledSessionId = createTestSessionId('query-fallback-disabled');
        const fallbackEnabledSessionId = createTestSessionId('query-fallback-enabled');

        const docs: SearchDocument[] = [
            {
                id: 'doc-query-safe-mode',
                title: 'Interface Search',
                content: 'interface integration guide',
                metadata: {}
            }
        ];

        const overrideEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false,
            synonyms: { api: ['interface'] }
        });
        const overrideOrchestrator = createMockOrchestrator({
            decideQueryExpansion: () => true
        }) as any;
        overrideEngine.setOrchestrator(overrideOrchestrator);
        await overrideEngine.indexDocuments(docs, overrideSessionId);

        const overrideResults = await overrideEngine.search('api', {
            expandSynonyms: false,
            sessionId: overrideSessionId,
            limit: 10
        });

        const overrideSignals = getSignalsByType(overrideOrchestrator, 'SEARCH_QUERY');
        assert.equal(overrideResults.length, 1, 'orchestrator should force synonym expansion even when local flag is false');
        assert.equal(overrideSignals.length, 1, 'forced expansion should emit one SEARCH_QUERY signal');
        assert.equal(overrideSignals[0].originalQuery, 'api');
        assert.ok(overrideSignals[0].expandedTerms.includes('interface'), 'expanded terms should include orchestrator-forced synonym');
        assert.equal(overrideSignals[0].graphExpansion, false, 'synonym override should not mark graph expansion');

        const fallbackDisabledEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false,
            synonyms: { api: ['interface'] }
        });
        const fallbackDisabledOrchestrator = createMockOrchestrator() as any;
        fallbackDisabledEngine.setOrchestrator(fallbackDisabledOrchestrator);
        await fallbackDisabledEngine.indexDocuments(docs, fallbackDisabledSessionId);

        const fallbackDisabledResults = await fallbackDisabledEngine.search('api', {
            expandSynonyms: false,
            sessionId: fallbackDisabledSessionId,
            limit: 10
        });

        assert.equal(fallbackDisabledResults.length, 0, 'undefined orchestrator decision should preserve local disabled expansion');
        assert.equal(getSignalsByType(fallbackDisabledOrchestrator, 'SEARCH_QUERY').length, 0, 'no SEARCH_QUERY signal should be emitted when local expansion stays disabled');

        const fallbackEnabledEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false,
            synonyms: { api: ['interface'] }
        });
        const fallbackEnabledOrchestrator = createMockOrchestrator() as any;
        fallbackEnabledEngine.setOrchestrator(fallbackEnabledOrchestrator);
        await fallbackEnabledEngine.indexDocuments(docs, fallbackEnabledSessionId);

        const fallbackEnabledResults = await fallbackEnabledEngine.search('api', {
            expandSynonyms: true,
            sessionId: fallbackEnabledSessionId,
            limit: 10
        });

        const fallbackEnabledSignals = getSignalsByType(fallbackEnabledOrchestrator, 'SEARCH_QUERY');
        assert.equal(fallbackEnabledResults.length, 1, 'undefined orchestrator decision should fall back to local enabled expansion');
        assert.equal(fallbackEnabledSignals.length, 1, 'local expansion should still emit SEARCH_QUERY signal');
        assert.ok(fallbackEnabledSignals[0].expandedTerms.includes('interface'), 'fallback to local expansion should include configured synonym');
    });

    await suite.test('Safe Mode keeps local default scoring weights when orchestrator returns undefined', async () => {
        const testSessionId = createTestSessionId('weights-fallback');
        const engine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });

        const orchestrator = createMockOrchestrator({
            decideSearchWeights: () => undefined
        }) as any;
        engine.setOrchestrator(orchestrator);

        await engine.indexDocuments([
            {
                id: 'doc-default-weights',
                title: 'Weight Defaults',
                content: 'weight defaults validation',
                metadata: {}
            }
        ], testSessionId);

        await engine.search('weight', {
            expandSynonyms: false,
            sessionId: testSessionId,
            limit: 10
        });

        const scoringSignals = getSignalsByType(orchestrator, 'SEARCH_SCORING');
        assert.equal(scoringSignals.length, 1, 'scoring should emit exactly one SEARCH_SCORING signal');
        assert.deepEqual(scoringSignals[0].weights, DEFAULT_WEIGHTS, 'undefined orchestrator weights should preserve scorer defaults');
        assert.equal(scoringSignals[0].semanticBoost, 1.0, 'semanticBoost should remain unchanged in fallback mode');
    });

    await suite.test('Safe Mode respects orchestrator override and local fallback for graph expansion', async () => {
        const overrideSessionId = createTestSessionId('graph-override');
        const fallbackSessionId = createTestSessionId('graph-fallback');

        const docs: SearchDocument[] = [
            {
                id: 'doc-graph-safe-mode',
                title: 'Graph Search',
                content: 'graphboost semantic relation',
                metadata: {}
            }
        ];

        const createGraphBridge = () => ({
            isEnabled: () => true,
            expandWithGraph: async () => ({
                expandedTerms: ['baseline', 'graphboost'],
                graphTerms: ['graphboost'],
                graphNodes: []
            }),
            syncDocumentRelations: async () => {},
            calculateGraphScore: () => 0,
            clearCaches: () => {},
            getStats: () => ({ expansionCacheSize: 0, enrichmentCacheSize: 0 })
        });

        const overrideEngine = new SearchEngine({ useGraphExpansion: false });
        (overrideEngine as any).graphBridge = createGraphBridge();
        const overrideOrchestrator = createMockOrchestrator({
            decideGraphExpansion: () => ({ enabled: true, maxTerms: 5, boost: 0.1 })
        }) as any;
        overrideEngine.setOrchestrator(overrideOrchestrator);
        await overrideEngine.indexDocuments(docs, overrideSessionId);

        const overrideResults = await overrideEngine.search('baseline', {
            expandSynonyms: false,
            expandWithGraph: false,
            sessionId: overrideSessionId,
            limit: 10
        });

        const overrideGraphSignals = getSignalsByType(overrideOrchestrator, 'SEARCH_QUERY').filter((signal: any) => signal.graphExpansion === true);
        assert.equal(overrideResults.length, 1, 'orchestrator graph override should expand query even when local graph flag is false');
        assert.equal(overrideGraphSignals.length, 1, 'graph override should emit SEARCH_QUERY signal for graph expansion');
        assert.deepEqual(overrideGraphSignals[0].expandedTerms, ['graphboost'], 'graph expansion signal should expose graph terms only');

        const fallbackEngine = new SearchEngine({ useGraphExpansion: false });
        (fallbackEngine as any).graphBridge = createGraphBridge();
        const fallbackOrchestrator = createMockOrchestrator() as any;
        fallbackEngine.setOrchestrator(fallbackOrchestrator);
        await fallbackEngine.indexDocuments(docs, fallbackSessionId);

        const fallbackResults = await fallbackEngine.search('baseline', {
            expandSynonyms: false,
            expandWithGraph: false,
            sessionId: fallbackSessionId,
            limit: 10
        });

        const fallbackGraphSignals = getSignalsByType(fallbackOrchestrator, 'SEARCH_QUERY').filter((signal: any) => signal.graphExpansion === true);
        assert.equal(fallbackResults.length, 0, 'undefined graph decision should preserve local graph-disabled behavior');
        assert.equal(fallbackGraphSignals.length, 0, 'no graph-expansion signal should be emitted when local graph expansion stays disabled');
    });

    await suite.test('Safe Mode falls back to local reranking and respects orchestrator veto', async () => {
        const fallbackSessionId = createTestSessionId('rerank-fallback');
        const vetoSessionId = createTestSessionId('rerank-veto');
        const docs: SearchDocument[] = [
            {
                id: 'rerank-safe-mode-1',
                title: 'Alpha Rerank',
                content: 'rerank alpha content',
                metadata: {}
            },
            {
                id: 'rerank-safe-mode-2',
                title: 'Beta Rerank',
                content: 'rerank beta content',
                metadata: {}
            }
        ];

        const fallbackEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });
        const fallbackOrchestrator = createMockOrchestrator() as any;
        fallbackEngine.setOrchestrator(fallbackOrchestrator);
        await fallbackEngine.indexDocuments(docs, fallbackSessionId);

        const fallbackResults = await fallbackEngine.search('rerank', {
            useRerank: true,
            expandSynonyms: false,
            sessionId: fallbackSessionId,
            limit: 10
        });

        assert.equal(fallbackResults.length, 2, 'local reranking path should still return both documents');
        assert.equal(getSignalsByType(fallbackOrchestrator, 'SEARCH_RERANKER').length, 1, 'undefined orchestrator decision should allow local reranking to run');

        const vetoEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });
        const vetoOrchestrator = createMockOrchestrator({
            decideReranking: () => false
        }) as any;
        vetoEngine.setOrchestrator(vetoOrchestrator);
        await vetoEngine.indexDocuments(docs, vetoSessionId);

        const vetoResults = await vetoEngine.search('rerank', {
            useRerank: true,
            expandSynonyms: false,
            sessionId: vetoSessionId,
            limit: 10
        });

        assert.equal(vetoResults.length, 2, 'orchestrator veto should not remove results, only skip reranking');
        assert.equal(getSignalsByType(vetoOrchestrator, 'SEARCH_RERANKER').length, 0, 'explicit false from orchestrator should block local reranking');
    });

    await suite.test('Safe Mode uses local fallback strategy when delegated and honors abort override', async () => {
        const localFallbackSessionId = createTestSessionId('fallback-local');
        const abortSessionId = createTestSessionId('fallback-abort');

        const docs: SearchDocument[] = [
            {
                id: 'doc-fallback-safe-mode',
                title: 'Fallback Safe Mode',
                content: 'fallback graph failure',
                metadata: {}
            }
        ];

        const createThrowingGraphBridge = () => ({
            isEnabled: () => true,
            expandWithGraph: async () => {
                throw new Error('Graph DB unavailable in safe mode test');
            },
            syncDocumentRelations: async () => {},
            calculateGraphScore: () => 0,
            clearCaches: () => {},
            getStats: () => ({ expansionCacheSize: 0, enrichmentCacheSize: 0 })
        });

        const localFallbackEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });
        (localFallbackEngine as any).graphBridge = createThrowingGraphBridge();
        const localFallbackOrchestrator = createMockOrchestrator({
            decideGraphExpansion: () => ({ enabled: true, maxTerms: 5, boost: 0.1 }),
            decideSearchFallbackStrategy: () => undefined
        }) as any;
        localFallbackEngine.setOrchestrator(localFallbackOrchestrator);
        await localFallbackEngine.indexDocuments(docs, localFallbackSessionId);

        await assert.doesNotReject(async () => {
            await localFallbackEngine.search('fallback', {
                expandSynonyms: false,
                sessionId: localFallbackSessionId,
                limit: 10
            });
        }, 'undefined fallback strategy should preserve local warn_and_continue behavior');

        const localFallbackSignals = getSignalsByType(localFallbackOrchestrator, 'SEARCH_FALLBACK');
        assert.equal(localFallbackSignals.length, 1, 'graph failure should emit one fallback signal in delegated mode');
        assert.equal(localFallbackSignals[0].fallbackStrategy, 'warn_and_continue', 'local fallback should default to warn_and_continue when orchestrator delegates');

        const abortEngine = new SearchEngine({
            useLLM: false,
            useRerank: false,
            useGraphExpansion: false
        });
        (abortEngine as any).graphBridge = createThrowingGraphBridge();
        const abortOrchestrator = createMockOrchestrator({
            decideGraphExpansion: () => ({ enabled: true, maxTerms: 5, boost: 0.1 }),
            decideSearchFallbackStrategy: () => 'abort'
        }) as any;
        abortEngine.setOrchestrator(abortOrchestrator);
        await abortEngine.indexDocuments(docs, abortSessionId);

        await assert.rejects(async () => {
            await abortEngine.search('fallback', {
                expandSynonyms: false,
                sessionId: abortSessionId,
                limit: 10
            });
        }, /Graph DB unavailable in safe mode test/, 'explicit abort from orchestrator should override local warn_and_continue');

        const abortSignals = getSignalsByType(abortOrchestrator, 'SEARCH_FALLBACK');
        assert.equal(abortSignals.length, 1, 'abort path should still emit fallback signal before throwing');
        assert.equal(abortSignals[0].fallbackStrategy, 'abort', 'fallback signal should record orchestrator abort override');
    });
});
