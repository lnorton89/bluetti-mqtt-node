import { ReadHoldingRegisters } from "../core/commands.js";
import type { WritableRange } from "../core/types.js";
import { BluettiDevice } from "./device.js";
import { DeviceStruct } from "./struct.js";

export const AC300OutputMode = {
  STOP: 0,
  INVERTER_OUTPUT: 1,
  BYPASS_OUTPUT_C: 2,
  BYPASS_OUTPUT_D: 3,
  LOAD_MATCHING: 4,
} as const;

export const AC300BatteryState = {
  STANDBY: 0,
  CHARGE: 1,
  DISCHARGE: 2,
} as const;

export const AC300UpsMode = {
  CUSTOMIZED: 1,
  PV_PRIORITY: 2,
  STANDARD: 3,
  TIME_CONTROL: 4,
} as const;

export const AC300MachineAddress = {
  SLAVE: 0,
  MASTER: 1,
} as const;

export const AC300AutoSleepMode = {
  THIRTY_SECONDS: 2,
  ONE_MINUTE: 3,
  FIVE_MINUTES: 4,
  NEVER: 5,
} as const;

function buildAc300Struct(): DeviceStruct {
  return new DeviceStruct()
    .addStringField("device_type", 10, 6)
    .addSerialNumberField("serial_number", 17)
    .addVersionField("arm_version", 23)
    .addVersionField("dsp_version", 25)
    .addUintField("dc_input_power", 36)
    .addUintField("ac_input_power", 37)
    .addUintField("ac_output_power", 38)
    .addUintField("dc_output_power", 39)
    .addDecimalField("power_generation", 41, 1)
    .addUintField("total_battery_percent", 43)
    .addBoolField("ac_output_on", 48)
    .addBoolField("dc_output_on", 49)
    .addEnumField("ac_output_mode", 70, AC300OutputMode)
    .addDecimalField("internal_ac_voltage", 71, 1)
    .addDecimalField("internal_current_one", 72, 1)
    .addUintField("internal_power_one", 73)
    .addDecimalField("internal_ac_frequency", 74, 2)
    .addDecimalField("internal_current_two", 75, 1)
    .addUintField("internal_power_two", 76)
    .addDecimalField("ac_input_voltage", 77, 1)
    .addDecimalField("internal_current_three", 78, 1, [0, 100] as const)
    .addUintField("internal_power_three", 79)
    .addDecimalField("ac_input_frequency", 80, 2)
    .addDecimalField("internal_dc_input_voltage", 86, 1)
    .addUintField("internal_dc_input_power", 87)
    .addDecimalField("internal_dc_input_current", 88, 1, [0, 15] as const)
    .addUintField("pack_num_max", 91)
    .addDecimalField("total_battery_voltage", 92, 1)
    .addDecimalField("total_battery_current", 93, 1)
    .addUintField("pack_num", 96)
    .addEnumField("pack_status", 97, AC300BatteryState)
    .addDecimalField("pack_voltage", 98, 2)
    .addUintField("pack_battery_percent", 99)
    .addDecimalArrayField("cell_voltages", 105, 16, 2)
    .addVersionField("pack_bms_version", 201)
    .addEnumField("ups_mode", 3001, AC300UpsMode)
    .addBoolField("split_phase_on", 3004)
    .addEnumField("split_phase_machine_mode", 3005, AC300MachineAddress)
    .addUintField("pack_num", 3006)
    .addBoolField("ac_output_on", 3007)
    .addBoolField("dc_output_on", 3008)
    .addBoolField("grid_charge_on", 3011)
    .addBoolField("time_control_on", 3013)
    .addUintField("battery_range_start", 3015)
    .addUintField("battery_range_end", 3016)
    .addBoolField("bluetooth_connected", 3036)
    .addEnumField("auto_sleep_mode", 3061, AC300AutoSleepMode);
}

export class AC300 extends BluettiDevice {
  constructor(address: string, serialNumber: string) {
    super(address, "AC300", serialNumber, buildAc300Struct());
  }

  override get packNumMax(): number {
    return 4;
  }

  override get pollingCommands(): readonly ReadHoldingRegisters[] {
    return [
      new ReadHoldingRegisters(10, 40),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3001, 61),
    ];
  }

  override get packPollingCommands(): readonly ReadHoldingRegisters[] {
    return [new ReadHoldingRegisters(91, 37)];
  }

  override get loggingCommands(): readonly ReadHoldingRegisters[] {
    return [
      new ReadHoldingRegisters(0, 70),
      new ReadHoldingRegisters(70, 21),
      new ReadHoldingRegisters(3000, 62),
    ];
  }

  override get packLoggingCommands(): readonly ReadHoldingRegisters[] {
    return [new ReadHoldingRegisters(91, 119)];
  }

  override get writableRanges(): readonly WritableRange[] {
    return [{ start: 3000, endExclusive: 3062 }];
  }
}
