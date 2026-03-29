import { ReadHoldingRegisters } from "../core/commands.js";
import { BluettiDevice } from "./device.js";
import { DeviceStruct } from "./struct.js";

function buildEp600Struct(): DeviceStruct {
  return new DeviceStruct()
    .addUintField("total_battery_percent", 102)
    .addSwapStringField("device_type", 110, 6)
    .addSerialNumberField("serial_number", 116)
    .addDecimalField("power_generation", 154, 1)
    .addSwapStringField("device_type", 1101, 6)
    .addSerialNumberField("serial_number", 1107)
    .addDecimalField("power_generation", 1202, 1)
    .addUintField("battery_range_start", 2022)
    .addUintField("battery_range_end", 2023)
    .addUintField("max_ac_input_power", 2213)
    .addUintField("max_ac_input_current", 2214)
    .addUintField("max_ac_output_power", 2215)
    .addUintField("max_ac_output_current", 2216)
    .addSwapStringField("battery_type", 6101, 6)
    .addSerialNumberField("battery_serial_number", 6107)
    .addVersionField("bcu_version", 6175)
    .addVersionField("bmu_version", 6178)
    .addVersionField("safety_module_version", 6181)
    .addVersionField("high_voltage_module_version", 6184);
}

export class EP600 extends BluettiDevice {
  constructor(address: string, serialNumber: string) {
    super(address, "EP600", serialNumber, buildEp600Struct());
  }

  override get pollingCommands(): readonly ReadHoldingRegisters[] {
    return [
      new ReadHoldingRegisters(100, 62),
      new ReadHoldingRegisters(2022, 2),
    ];
  }

  override get loggingCommands(): readonly ReadHoldingRegisters[] {
    return [
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
    ];
  }
}
