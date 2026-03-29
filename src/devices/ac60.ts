import { ReadHoldingRegisters } from "../core/commands.js";
import { BluettiDevice } from "./device.js";
import { DeviceStruct } from "./struct.js";

function buildAc60Struct(): DeviceStruct {
  return new DeviceStruct()
    .addUintField("total_battery_percent", 102)
    .addSwapStringField("device_type", 110, 6)
    .addSerialNumberField("serial_number", 116)
    .addDecimalField("power_generation", 154, 1)
    .addSwapStringField("device_type", 1101, 6)
    .addSerialNumberField("serial_number", 1107)
    .addDecimalField("power_generation", 1202, 1)
    .addSwapStringField("battery_type", 6101, 6)
    .addSerialNumberField("battery_serial_number", 6107)
    .addVersionField("bcu_version", 6175);
}

export class AC60 extends BluettiDevice {
  constructor(address: string, serialNumber: string) {
    super(address, "AC60", serialNumber, buildAc60Struct());
  }

  override get pollingCommands(): readonly ReadHoldingRegisters[] {
    return [new ReadHoldingRegisters(100, 62)];
  }

  override get loggingCommands(): readonly ReadHoldingRegisters[] {
    return [
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
    ];
  }
}
