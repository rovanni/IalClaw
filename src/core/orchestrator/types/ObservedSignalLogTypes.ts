export type ObservedSignalLogEntry = {
    event: string;
    message: string;
    payload: Record<string, unknown>;
};

export type ObservedStopSignalLogEntry = ObservedSignalLogEntry;
