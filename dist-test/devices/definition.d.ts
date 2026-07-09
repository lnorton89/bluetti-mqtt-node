import { ReadHoldingRegisters } from "@core/commands.js";
import type { WritableRange } from "@core/types.js";
import { BluettiDevice } from "./device.js";
import type { DeviceStruct } from "./struct.js";
/**
 * Declarative device configuration consumed by {@link BluettiDeviceModel}.
 *
 * Each entry defines one supported Bluetti product family's register layout,
 * polling windows, and writable control ranges.
 */
export interface DeviceDefinition {
    readonly type: string;
    readonly packNumMax: number;
    readonly pollingCommands: readonly ReadHoldingRegisters[];
    readonly packPollingCommands?: readonly ReadHoldingRegisters[];
    readonly loggingCommands: readonly ReadHoldingRegisters[];
    readonly packLoggingCommands?: readonly ReadHoldingRegisters[];
    readonly writableRanges?: readonly WritableRange[];
    readonly buildStruct: () => DeviceStruct;
}
export declare const BLUETTI_DEFINITIONS: readonly DeviceDefinition[];
export declare const BLUETTI_DEFINITION_MAP: ReadonlyMap<string, DeviceDefinition>;
export declare class BluettiDeviceModel extends BluettiDevice {
    private readonly def;
    constructor(address: string, serialNumber: string, def: DeviceDefinition);
    get packNumMax(): number;
    get pollingCommands(): readonly ReadHoldingRegisters[];
    get packPollingCommands(): readonly ReadHoldingRegisters[];
    get loggingCommands(): readonly ReadHoldingRegisters[];
    get packLoggingCommands(): readonly ReadHoldingRegisters[];
    get writableRanges(): readonly WritableRange[];
}
