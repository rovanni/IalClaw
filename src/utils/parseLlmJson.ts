export function parseLlmJson<T = any>(raw: string): T {
    if (!raw) {
        throw new Error('Empty LLM response');
    }

    let cleaned = raw.trim();

    if (cleaned.startsWith('```')) {
        cleaned = cleaned
            .replace(/^```[a-zA-Z]*\r?\n?/, '')
            .replace(/```$/, '')
            .trim();
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(cleaned) as T;
    } catch {
        throw new Error(`Failed to parse LLM JSON:\n${cleaned.slice(0, 500)}`);
    }
}
