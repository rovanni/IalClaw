import Database from 'better-sqlite3';
import { CognitiveMemory } from '../src/memory/CognitiveMemory';
import { MemoryService } from '../src/memory/MemoryService';
import { EmbeddingService } from '../src/memory/EmbeddingService';
import { LLMProvider, MessagePayload, ProviderResponse } from '../src/engine/ProviderFactory';
import * as fs from 'fs';
import * as path from 'path';

// --- Mocks ---

class MockLLMProvider implements LLMProvider {
    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        return { final_answer: "Mock answer" };
    }
    async embed(text: string): Promise<number[]> {
        // Return a deterministic vector based on text length for testing
        const val = (text.length % 10) / 10;
        return [val, val, val];
    }
}

class MockEmbeddingService implements EmbeddingService {
    async generate(text: string): Promise<number[] | null> {
        const val = (text.length % 10) / 10;
        return [val, val, val];
    }
}

// --- Test Runner ---

async function runTests() {
    console.log("🚀 Starting Memory System Verification Tests...\n");

    // 1. Setup Database
    const db = new Database(':memory:');
    const schema = fs.readFileSync(path.resolve(__dirname, '../src/db/schema.sql'), 'utf8');
    db.exec(schema);
    console.log("✅ Database initialized.");

    const provider = new MockLLMProvider();
    const embeddingService = new MockEmbeddingService();

    // 2. Test MemoryService
    const memoryService = new MemoryService(db, embeddingService);
    console.log("🧪 Testing MemoryService...");

    await memoryService.upsertMemory({
        content: "The IalClaw project is an agentic AI system.",
        type: "semantic",
        importance: 0.8,
        relevance: 0.9,
        entities: ["IalClaw", "AI"],
        context: { sessionId: "test_session" }
    });

    const queryResults = await memoryService.queryMemory("What is IalClaw?");
    if (queryResults.length > 0 && queryResults[0].content.includes("IalClaw")) {
        console.log("✅ MemoryService.queryMemory: Success");
    } else {
        console.log("❌ MemoryService.queryMemory: Failed", queryResults);
    }

    // 3. Test CognitiveMemory
    const cognitiveMemory = new CognitiveMemory(db, provider);
    console.log("🧪 Testing CognitiveMemory...");

    // Test getConversationHistory
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(
        "session1", "user", "Hello", new Date().toISOString()
    );
    const history = cognitiveMemory.getConversationHistory("session1");
    if (history.length === 1 && history[0].content === "Hello") {
        console.log("✅ CognitiveMemory.getConversationHistory: Success");
    } else {
        console.log("❌ CognitiveMemory.getConversationHistory: Failed", history);
    }

    // Test indexCodeNode
    await cognitiveMemory.indexCodeNode({
        project_id: "test_proj",
        relative_path: "src/main.ts",
        raw_content: "console.log('hello');"
    });

    const searchResults = cognitiveMemory.searchByContent("console");
    if (searchResults.length > 0 && searchResults[0].name === "src/main.ts") {
        console.log("✅ CognitiveMemory.indexCodeNode / searchByContent: Success");
    } else {
        console.log("❌ CognitiveMemory.indexCodeNode / searchByContent: Failed", searchResults);
    }

    // Test retrieveWithTraversal
    const traversed = await cognitiveMemory.retrieveWithTraversal("main code", [0.1, 0.1, 0.1]);
    if (traversed.length > 0) {
        console.log("✅ CognitiveMemory.retrieveWithTraversal: Success");
    } else {
        console.log("❌ CognitiveMemory.retrieveWithTraversal: Failed", traversed);
    }

    // Test saveExecutionFix
    cognitiveMemory.saveExecutionFix({
        content: "Fixed import error",
        error_type: "ImportError",
        fingerprint: "imp123"
    });
    const fixNode = db.prepare("SELECT * FROM nodes WHERE id = ?").get("fix:imp123") as any;
    if (fixNode && fixNode.content === "Fixed import error") {
        console.log("✅ CognitiveMemory.saveExecutionFix: Success");
    } else {
        console.log("❌ CognitiveMemory.saveExecutionFix: Failed", fixNode);
    }

    // Test learn
    await cognitiveMemory.learn({
        query: "how to fix import",
        success: true,
        nodes_used: [fixNode]
    });
    console.log("✅ CognitiveMemory.learn: Success (no throw)");

    console.log("\n✨ All tests completed!");
}

runTests().catch(err => {
    console.error("🔥 Test suite failed:", err);
    process.exit(1);
});
