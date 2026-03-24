export function classifyError(error: string): string {
    if (!error) return 'unknown';

    if (error.includes('Invalid input for tool') || error.includes('tool_input_error')) return 'tool_input';
    if (error.includes('Puppeteer is not installed')) return 'environment_dependency';
    if (error.includes('Project output path not found')) return 'environment';
    if (error.includes('Unexpected token')) return 'syntax';
    if (error.includes('is not defined')) return 'reference';
    if (error.includes('Cannot read')) return 'null_access';
    if (error.includes('not a function')) return 'type_error';
    if (error.includes('Failed to fetch')) return 'network';

    return 'unknown';
}
