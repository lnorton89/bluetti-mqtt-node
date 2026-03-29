import { ReadHoldingRegisters } from "../core/commands.js";
import type { WritableRange } from "../core/types.js";
import { BluettiDevice } from "./device.js";
import { DeviceStruct } from "./struct.js";

export const EB3ALedMode = {
  LOW: 1,
  HIGH: 2,
  SOS: 3,
  OFF: 4,
} as const;

export const EB3AEcoShutdown = {
  ONE_HOUR: 1,
  TWO_HOURS: 2,
  THREE_HOURS: 3,
  FOUR_HOURS: 4,
} as const;

export const EB3AChargingMode = {
  STANDARD: 0,
  SILENT: 1,
  TURBO: 2,
} as const;

function buildEb3aStruct(): DeviceStruct {
  return new DeviceStruct()
    .addStringField("device_type", 10, 6)
    .addSerialNumberField("serial_number", 17)
    .addVersionField("arm_version", 23)
    .addVersionField("dsp_version", 25)
    .addUintField("dc_input_power", 36)
    .addUintField("ac_input_power", 37)
    .addUintField("ac_output_power", 38)
    .addUintField("dc_output_power", 39)
    .addUintField("total_battery_percent", 43)
    .addBoolField("ac_output_on", 48)
    .addBoolField("dc_output_on", 49)
    .addDecimalField("ac_input_voltage", 77, 1)
    .addDecimalField("internal_dc_input_voltage", 86, 2)
    .addUintField("pack_num_max", 91)
    .addBoolField("ac_output_on", 3007)
    .addBoolField("dc_output_on", 3008)
    .addEnumField("led_mode", 3034, EB3ALedMode)
    .addBoolField("power_off", 3060)
    .addBoolField("eco_on", 3063)
    .addEnumField("eco_shutdown", 3064, EB3AEcoShutdown)
    .addEnumField("charging_mode", 3065, EB3AChargingMode)
    .addBoolField("power_lifting_on", 3066);
}

export class EB3A extends BluettiDevice {
  constructor(address: string, serialNumber: string) {
    super(address, "EB3A", serialNumber, buildEb3aStruct());
  }

  override get pollingCommands(): readonly ReadHoldingRegisters[] {
    return [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3034, 1),
      new ReadHoldingRegisters(3060, 7),
    ];
  }

  override get loggingCommands(): readonly ReadHoldingRegisters[] {
    return [
      new ReadHoldingRegisters(10, 53),
      new ReadHoldingRegisters(70, 66),
      new ReadHoldingRegisters(136, 74),
      new ReadHoldingRegisters(3000, 67),
    ];
  }

  override get writableRanges(): readonly WritableRange[] {
    return [{ start: 3000, endExclusive: 3067 }];
  }
}
