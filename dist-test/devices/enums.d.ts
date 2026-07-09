export declare const OutputMode: {
    readonly STOP: 0;
    readonly INVERTER_OUTPUT: 1;
    readonly BYPASS_OUTPUT_C: 2;
    readonly BYPASS_OUTPUT_D: 3;
    readonly LOAD_MATCHING: 4;
};
export declare const BatteryState: {
    readonly STANDBY: 0;
    readonly CHARGE: 1;
    readonly DISCHARGE: 2;
};
export declare const UpsMode: {
    readonly CUSTOMIZED: 1;
    readonly PV_PRIORITY: 2;
    readonly STANDARD: 3;
    readonly TIME_CONTROL: 4;
};
export declare const MachineAddress: {
    readonly SLAVE: 0;
    readonly MASTER: 1;
};
export declare const AutoSleepMode: {
    readonly THIRTY_SECONDS: 2;
    readonly ONE_MINUTE: 3;
    readonly FIVE_MINUTES: 4;
    readonly NEVER: 5;
};
export declare const LedMode: {
    readonly LOW: 1;
    readonly HIGH: 2;
    readonly SOS: 3;
    readonly OFF: 4;
};
export declare const EcoShutdown: {
    readonly ONE_HOUR: 1;
    readonly TWO_HOURS: 2;
    readonly THREE_HOURS: 3;
    readonly FOUR_HOURS: 4;
};
export declare const ChargingMode: {
    readonly STANDARD: 0;
    readonly SILENT: 1;
    readonly TURBO: 2;
};
