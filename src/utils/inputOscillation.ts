function stableStringify(obj: any): string {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

export function detectOscillation(history: string[], newInput: any): boolean {
    const serialized = stableStringify(newInput);
    return history.includes(serialized);
}

export function updateHistory(history: string[], newInput: any, max = 5): string[] {
    const serialized = stableStringify(newInput);
    const updated = [...history, serialized];

    if (updated.length > max) {
        updated.shift();
    }

    return updated;
}
