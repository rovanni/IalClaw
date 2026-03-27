export interface TokenizeOptions {
    minLength?: number;
    maxLength?: number;
    preserveCase?: boolean;
}

export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
    const {
        minLength = 2,
        maxLength = 50,
        preserveCase = false
    } = options;

    if (!text || typeof text !== 'string') {
        return [];
    }

    const tokens = text
        .toLowerCase()
        .replace(/[^\w\s\u00C0-\u00FF]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length >= minLength && token.length <= maxLength);

    return preserveCase ? tokens : tokens;
}

export function tokenizeWithPositions(text: string): Array<{ token: string; start: number; end: number }> {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const results: Array<{ token: string; start: number; end: number }> = [];
    const regex = /\b[\w\u00C0-\u00FF]+\b/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        results.push({
            token: match[0].toLowerCase(),
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return results;
}

export function extractPhrases(text: string, minWords: number = 2, maxWords: number = 4): string[] {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const phrases: string[] = [];

    for (let i = 0; i < words.length; i++) {
        for (let j = minWords; j <= maxWords && i + j <= words.length; j++) {
            const phrase = words.slice(i, i + j).join(' ');
            phrases.push(phrase);
        }
    }

    return phrases;
}
