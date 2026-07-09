export const OutputMode = {
    STOP: 0,
    INVERTER_OUTPUT: 1,
    BYPASS_OUTPUT_C: 2,
    BYPASS_OUTPUT_D: 3,
    LOAD_MATCHING: 4,
};
export const BatteryState = {
    STANDBY: 0,
    CHARGE: 1,
    DISCHARGE: 2,
};
export const UpsMode = {
    CUSTOMIZED: 1,
    PV_PRIORITY: 2,
    STANDARD: 3,
    TIME_CONTROL: 4,
};
export const MachineAddress = {
    SLAVE: 0,
    MASTER: 1,
};
export const AutoSleepMode = {
    THIRTY_SECONDS: 2,
    ONE_MINUTE: 3,
    FIVE_MINUTES: 4,
    NEVER: 5,
};
export const LedMode = {
    LOW: 1,
    HIGH: 2,
    SOS: 3,
    OFF: 4,
};
export const EcoShutdown = {
    ONE_HOUR: 1,
    TWO_HOURS: 2,
    THREE_HOURS: 3,
    FOUR_HOURS: 4,
};
export const ChargingMode = {
    STANDARD: 0,
    SILENT: 1,
    TURBO: 2,
};
