import { ReadHoldingRegisters } from "@core/commands.js";
import type { WritableRange } from "@core/types.js";
import { BluettiDevice } from "./device.js";
import {
  buildAc200mStruct,
  buildAc300Struct,
  buildAc500Struct,
  buildAc60Struct,
  buildEb3aStruct,
  buildEp500Struct,
  buildEp600Struct,
} from "./device-builders.js";
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

// ---------------------------------------------------------------------------
// Device table
// ---------------------------------------------------------------------------

export const BLUETTI_DEFINITIONS: readonly DeviceDefinition[] = [
  {
    type: "AC200M",
    packNumMax: 3,
    pollingCommands: [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ],
    packPollingCommands: [new ReadHoldingRegisters(91, 37)],
    loggingCommands: [
      new ReadHoldingRegisters(0, 70),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ],
    packLoggingCommands: [new ReadHoldingRegisters(91, 119)],
    writableRanges: [{ start: 3000, endExclusive: 3062 }],
    buildStruct: buildAc200mStruct,
  },
  {
    type: "AC300",
    packNumMax: 4,
    pollingCommands: [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 90),
      new ReadHoldingRegisters(160, 46),
      new ReadHoldingRegisters(3001, 61),
    ],
    packPollingCommands: [new ReadHoldingRegisters(91, 37)],
    loggingCommands: [
      new ReadHoldingRegisters(0, 70),
      new ReadHoldingRegisters(70, 90),
      new ReadHoldingRegisters(160, 46),
      new ReadHoldingRegisters(3000, 62),
    ],
    packLoggingCommands: [new ReadHoldingRegisters(91, 119)],
    writableRanges: [{ start: 3000, endExclusive: 3062 }],
    buildStruct: buildAc300Struct,
  },
  {
    type: "AC500",
    packNumMax: 6,
    pollingCommands: [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 90),
      new ReadHoldingRegisters(160, 46),
      new ReadHoldingRegisters(3001, 61),
    ],
    packPollingCommands: [new ReadHoldingRegisters(91, 37)],
    loggingCommands: [
      new ReadHoldingRegisters(0, 70),
      new ReadHoldingRegisters(70, 90),
      new ReadHoldingRegisters(160, 46),
      new ReadHoldingRegisters(3000, 62),
    ],
    packLoggingCommands: [new ReadHoldingRegisters(91, 119)],
    writableRanges: [{ start: 3000, endExclusive: 3062 }],
    buildStruct: buildAc500Struct,
  },
  {
    type: "AC60",
    packNumMax: 1,
    pollingCommands: [new ReadHoldingRegisters(100, 62)],
    loggingCommands: [
      new ReadHoldingRegisters(100, 62),
      new ReadHoldingRegisters(1100, 51),
      new ReadHoldingRegisters(1200, 90),
      new ReadHoldingRegisters(1300, 31),
      new ReadHoldingRegisters(1400, 48),
      new ReadHoldingRegisters(1500, 30),
      new ReadHoldingRegisters(2000, 67),
      new ReadHoldingRegisters(2200, 29),
      new ReadHoldingRegisters(6000, 31),
      new ReadHoldingRegisters(6100, 100),
      new ReadHoldingRegisters(6300, 52),
    ],
    buildStruct: buildAc60Struct,
  },
  {
    type: "EB3A",
    packNumMax: 1,
    pollingCommands: [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3034, 1),
      new ReadHoldingRegisters(3060, 7),
    ],
    loggingCommands: [
      new ReadHoldingRegisters(10, 53),
      new ReadHoldingRegisters(70, 66),
      new ReadHoldingRegisters(136, 74),
      new ReadHoldingRegisters(3000, 67),
    ],
    writableRanges: [{ start: 3000, endExclusive: 3067 }],
    buildStruct: buildEb3aStruct,
  },
  {
    type: "EP500",
    packNumMax: 1,
    pollingCommands: [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ],
    packPollingCommands: [new ReadHoldingRegisters(91, 37)],
    loggingCommands: [
      new ReadHoldingRegisters(0, 70),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ],
    packLoggingCommands: [new ReadHoldingRegisters(91, 119)],
    writableRanges: [{ start: 3000, endExclusive: 3062 }],
    buildStruct: buildEp500Struct,
  },
  {
    type: "EP500P",
    packNumMax: 1,
    pollingCommands: [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ],
    packPollingCommands: [new ReadHoldingRegisters(91, 37)],
    loggingCommands: [
      new ReadHoldingRegisters(0, 70),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ],
    packLoggingCommands: [new ReadHoldingRegisters(91, 119)],
    writableRanges: [{ start: 3000, endExclusive: 3062 }],
    buildStruct: buildEp500Struct,
  },
  {
    type: "EP600",
    packNumMax: 1,
    pollingCommands: [
      new ReadHoldingRegisters(100, 62),
      new ReadHoldingRegisters(2022, 2),
    ],
    loggingCommands: [
      new ReadHoldingRegisters(100, 62),
      new ReadHoldingRegisters(1100, 51),
      new ReadHoldingRegisters(1200, 90),
      new ReadHoldingRegisters(1300, 31),
      new ReadHoldingRegisters(1400, 48),
      new ReadHoldingRegisters(1500, 30),
      new ReadHoldingRegisters(2000, 89),
      new ReadHoldingRegisters(2200, 41),
      new ReadHoldingRegisters(2300, 36),
      new ReadHoldingRegisters(6000, 32),
      new ReadHoldingRegisters(6100, 100),
      new ReadHoldingRegisters(6300, 100),
    ],
    buildStruct: buildEp600Struct,
  },
] as const;

export const BLUETTI_DEFINITION_MAP: ReadonlyMap<string, DeviceDefinition> = new Map(
  BLUETTI_DEFINITIONS.map((def) => [def.type, def]),
);

export class BluettiDeviceModel extends BluettiDevice {
  private readonly def: DeviceDefinition;

  constructor(address: string, serialNumber: string, def: DeviceDefinition) {
    super(address, def.type, serialNumber, def.buildStruct());
    this.def = def;
  }

  override get packNumMax(): number {
    return this.def.packNumMax;
  }

  override get pollingCommands(): readonly ReadHoldingRegisters[] {
    return this.def.pollingCommands;
  }

  override get packPollingCommands(): readonly ReadHoldingRegisters[] {
    return this.def.packPollingCommands ?? [];
  }

  override get loggingCommands(): readonly ReadHoldingRegisters[] {
    return this.def.loggingCommands;
  }

  override get packLoggingCommands(): readonly ReadHoldingRegisters[] {
    return this.def.packLoggingCommands ?? [];
  }

  override get writableRanges(): readonly WritableRange[] {
    return this.def.writableRanges ?? [];
  }
}
