import { Capability } from './CapabilityRegistry';

export type TaskType =
    | 'web_generation'
    | 'browser_validation'
    | 'file_edit'
    | 'project_init';

export function getRequiredCapabilities(task: {
    type: TaskType;
    requiresDOM?: boolean;
}): Capability[] {
    const capabilities: Capability[] = [];

    if (task.type === 'file_edit') {
        capabilities.push('fs_access');
    }

    if (task.type === 'project_init') {
        capabilities.push('fs_access');
    }

    if (task.type === 'web_generation') {
        capabilities.push('fs_access');

        if (task.requiresDOM) {
            capabilities.push('browser_execution');
        }
    }

    if (task.type === 'browser_validation') {
        capabilities.push('browser_execution', 'fs_access');
    }

    return capabilities;
}
