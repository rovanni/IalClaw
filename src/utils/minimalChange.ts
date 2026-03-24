export function isMinimalChange(prevStep: any, newStep: any, issues: any[]): boolean {
    if (!prevStep?.input || !newStep?.input) return false;

    const changedFields = Object.keys(newStep.input).filter(
        key => prevStep.input[key] !== newStep.input[key]
    );

    const allowedFields = issues.map((issue: any) => String(issue.path || '').split('.')[0]);

    return changedFields.every(field => allowedFields.includes(field));
}
