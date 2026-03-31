import { Flow, FlowStep } from '../types';
import { createLogger } from '../../../shared/AppLogger';

export class HtmlSlidesFlow implements Flow {
    public id = 'html-slides';
    public topic = 'slide';
    private logger = createLogger('HtmlSlidesFlow');

    public steps: FlowStep[] = [
        {
            id: 'get_content',
            prompt: (ctx) => "Qual conteúdo você deseja usar para os slides?\n\n• Colar o texto aqui\n• Informar o caminho de um arquivo\n• Descrever o conteúdo que deseja",
            validate: (input) => input.trim().length > 5,
            process: (input, ctx) => {
                ctx.content = input;
            }
        }
    ];

    public async onComplete(context: Record<string, any>): Promise<any> {
        this.logger.info('onComplete', 'Flow completed, generating slides...');
        // In a real scenario, this would call the agent's internal tool or a service
        return {
            action: 'call_tool',
            tool: 'html_slides',
            args: { content: context.content }
        };
    }

    public onCancel(context: Record<string, any>): void {
        this.logger.info('onCancel', 'Flow was cancelled.');
    }
}
