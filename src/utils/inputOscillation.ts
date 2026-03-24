export function detectOscillation(history: string[], newInput: any): boolean {
    const serialized = JSON.stringify(newInput);
    return history.includes(serialized);
}

export function updateHistory(history: string[], newInput: any, max = 5): string[] {
    const serialized = JSON.stringify(newInput);
    const updated = [...history, serialized];

    if (updated.length > max) {
        updated.shift();
    }

    return updated;
}
