export interface TemplateVariable {
    name: string;
    value: string;
    required?: boolean;
}

export interface BuildPromptOptions {
    throwOnMissing?: boolean;
    trim?: boolean;
}

const PLACEHOLDER_REGEX = /\{\{([\w\.\-\:]+)\}\}/g;

export function buildPrompt(
    template: string,
    variables: Record<string, string | number | boolean>,
    options: BuildPromptOptions = {}
): string {
    const {
        throwOnMissing = true,
        trim = true
    } = options;

    const missingVars: string[] = [];
    const usedVars: Set<string> = new Set();

    const resolved = template.replace(PLACEHOLDER_REGEX, (match, varName) => {
        usedVars.add(varName);

        if (!(varName in variables) || variables[varName] === undefined || variables[varName] === null) {
            missingVars.push(varName);
            return match;
        }

        let value = variables[varName];
        
        if (typeof value === 'object') {
            value = JSON.stringify(value, null, 2);
        } else {
            value = String(value);
        }

        if (trim) {
            value = value.trim();
        }

        return value;
    });

    const unresolvedMatches = resolved.match(/\{\{[\w\.\-\:]+\}\}/g);
    if (unresolvedMatches) {
        for (const match of unresolvedMatches) {
            const varName = match.replace(/\{\{|\}\}/g, '');
            if (!usedVars.has(varName)) {
                missingVars.push(varName);
            }
        }
    }

    if (throwOnMissing && missingVars.length > 0) {
        throw new Error(
            `Template variável(s) não substituída(s): ${missingVars.join(', ')}. ` +
            `Prompt gerado está incompleto.`
        );
    }

    return resolved;
}

export function validateTemplate(template: string): {
    valid: boolean;
    variables: string[];
    missing: string[];
} {
    const variables: string[] = [];
    let match;

    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    while ((match = regex.exec(template)) !== null) {
        variables.push(match[1]);
    }

    const uniqueVars = Array.from(new Set(variables));

    return {
        valid: uniqueVars.length === 0 || variables.length > 0,
        variables: uniqueVars,
        missing: []
    };
}

export function extractVariables(template: string): string[] {
    const variables: string[] = [];
    let match;

    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    while ((match = regex.exec(template)) !== null) {
        variables.push(match[1]);
    }

    return Array.from(new Set(variables));
}

export function hasUnresolvedPlaceholders(text: string): boolean {
    const matches = text.match(/\{\{[\w\.\-\:]+\}\}/g);
    return matches !== null && matches.length > 0;
}

export function checkPromptSafety(prompt: string): boolean {
    if (hasUnresolvedPlaceholders(prompt)) {
        throw new Error(
            'Prompt contém placeholders não resolvidos ({{variavel}}). ' +
            'Isso pode resultar em prompts incompletos sendo enviados ao LLM.'
        );
    }
    return true;
}
