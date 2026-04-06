import { Flow } from './types';
import { HtmlSlidesFlow } from './flows/HtmlSlidesFlow';
import { createLogger } from '../../shared/AppLogger';

type FlowClass = new () => Flow;

export type FlowRegistration = {
    id: string;
    flowClass: FlowClass;
    tags?: string[];
    triggers?: string[];
    priority?: number;
    description?: string;
};

const DEFAULT_FLOWS: FlowRegistration[] = [
    {
        id: 'html_slides',
        flowClass: HtmlSlidesFlow,
        tags: ['slides', 'html', 'presentation'],
        triggers: ['criar slides', 'gerar slides', 'slides html', 'apresentacao html'],
        priority: 10,
        description: 'Guided flow for creating HTML slide content.'
    }
];

export class FlowRegistry {
    private static logger = createLogger('FlowRegistry');
    private static flows: Map<string, FlowRegistration> = new Map();

    static {
        this.registerMany(DEFAULT_FLOWS);
    }

    /**
     * Registers a flow class.
     */
    public static register(id: string, flowClass: FlowClass): void {
        this.registerDefinition({ id, flowClass });
    }

    public static registerMany(registrations: ReadonlyArray<FlowRegistration>): void {
        for (const registration of registrations) {
            this.registerDefinition(registration);
        }
    }

    public static registerDefinition(registration: FlowRegistration): void {
        this.flows.set(registration.id, {
            ...registration,
            tags: registration.tags ? [...registration.tags] : undefined,
            triggers: registration.triggers ? [...registration.triggers] : undefined
        });
        this.logger.info('flow_registered', `Flow ${registration.id} registered successfully.`);
    }

    /**
     * Gets a new instance of a flow by ID.
     */
    public static get(id: string): Flow | null {
        const registration = this.flows.get(id);
        if (!registration) {
            this.logger.warn('flow_not_found', `Flow ${id} not found in registry.`);
            return null;
        }
        return new registration.flowClass();
    }

    /**
     * Lists all registered flow IDs.
     */
    public static list(): string[] {
        return Array.from(this.flows.keys());
    }

    public static has(id: string): boolean {
        return this.flows.has(id);
    }

    public static listDefinitions(): Array<Omit<FlowRegistration, 'flowClass'>> {
        return Array.from(this.flows.values()).map((registration) => ({
            id: registration.id,
            tags: registration.tags ? [...registration.tags] : undefined,
            triggers: registration.triggers ? [...registration.triggers] : undefined,
            priority: registration.priority,
            description: registration.description
        }));
    }
}
