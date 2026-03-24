import test from 'node:test';
import assert from 'node:assert/strict';
import { getRequiredCapabilitiesForPlanStep } from '../capabilities/taskCapabilities';

test('web_generation sem DOM exige apenas fs_access', () => {
    const step = {
        id: 1,
        type: 'tool' as const,
        tool: 'workspace_save_artifact',
        input: {}
    };

    assert.deepEqual(getRequiredCapabilitiesForPlanStep(step), ['fs_access']);
});

test('web_generation com DOM exige fs_access e browser_execution', () => {
    const step = {
        id: 1,
        type: 'tool' as const,
        tool: 'workspace_save_artifact',
        input: {},
        capabilities: { requiresDOM: true }
    };

    assert.deepEqual(getRequiredCapabilitiesForPlanStep(step), ['fs_access', 'browser_execution']);
});
