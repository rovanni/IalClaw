import { isConversion } from './detectors/ConversionDetector';
import { isExecution } from './detectors/ExecutionDetector';
import { isExploration } from './detectors/ExplorationDetector';
import { IntentResult } from './IntentResult';

export class IntentClassifier {
    public classify(input: string): IntentResult {
        const exploration = isExploration(input);
        const conversion = isConversion(input);
        const execution = conversion || isExecution(input);

        if (exploration && execution && !conversion) {
            return { mode: 'HYBRID', confidence: 0.78 };
        }

        if (exploration) {
            return { mode: 'EXPLORATION', confidence: 0.92 };
        }

        if (conversion) {
            return { mode: 'EXECUTION', confidence: 0.96 };
        }

        if (execution) {
            return { mode: 'EXECUTION', confidence: 0.78 };
        }

        return { mode: 'UNKNOWN', confidence: 0.2 };
    }
}