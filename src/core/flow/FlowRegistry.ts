import { Flow } from './types';
import { HtmlSlidesFlow } from './flows/HtmlSlidesFlow';
import { createLogger } from '../../shared/AppLogger';

export class FlowRegistry {
    private static logger = createLogger('FlowRegistry');
    private static flows: Map<string, new () => Flow> = new Map();

    static {
        // Register default flows
        this.register('html_slides', HtmlSlidesFlow);
    }

    /**
     * Registers a flow class.
     */
    public static register(id: string, flowClass: new () => Flow): void {
        this.flows.set(id, flowClass);
        this.logger.info('flow_registered', `Flow ${id} registered successfully.`);
    }

    /**
     * Gets a new instance of a flow by ID.
     */
    public static get(id: string): Flow | null {
        const FlowClass = this.flows.get(id);
        if (!FlowClass) {
            this.logger.warn('flow_not_found', `Flow ${id} not found in registry.`);
            return null;
        }
        return new FlowClass();
    }

    /**
     * Lists all registered flow IDs.
     */
    public static list(): string[] {
        return Array.from(this.flows.keys());
    }
}
