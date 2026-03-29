import { ReadHoldingRegisters, WriteSingleRegister } from "../core/commands.js";
import { isAddressWritable, type WritableRange } from "../core/types.js";
import { BoolField, DeviceStruct, EnumField } from "./struct.js";

export abstract class BluettiDevice {
  readonly address: string;
  readonly type: string;
  readonly serialNumber: string;
  readonly struct: DeviceStruct;

  protected constructor(address: string, type: string, serialNumber: string, struct: DeviceStruct) {
    this.address = address;
    this.type = type;
    this.serialNumber = serialNumber;
    this.struct = struct;
  }

  parse(address: number, data: Uint8Array) {
    return this.struct.parse(address, data);
  }

  get packNumMax(): number {
    return 1;
  }

  abstract get pollingCommands(): readonly ReadHoldingRegisters[];

  get packPollingCommands(): readonly ReadHoldingRegisters[] {
    return [];
  }

  abstract get loggingCommands(): readonly ReadHoldingRegisters[];

  get packLoggingCommands(): readonly ReadHoldingRegisters[] {
    return [];
  }

  get writableRanges(): readonly WritableRange[] {
    return [];
  }

  hasField(fieldName: string): boolean {
    return this.struct.fields.some((field) => field.name === fieldName);
  }

  hasFieldSetter(fieldName: string): boolean {
    return this.struct.fields.some(
      (field) => field.name === fieldName && isAddressWritable(field.address, this.writableRanges),
    );
  }

  buildSetterCommand(fieldName: string, value: boolean | number | string): WriteSingleRegister {
    const field = this.struct.fields.find(
      (candidate) => candidate.name === fieldName && isAddressWritable(candidate.address, this.writableRanges),
    );
    if (field === undefined) {
      throw new Error(`Field ${fieldName} is not writable on ${this.type}`);
    }

    let encodedValue: number;
    if (field instanceof EnumField) {
      if (typeof value === "number") {
        encodedValue = value;
      } else if (typeof value === "string" && field.enumDefinition[value] !== undefined) {
        encodedValue = field.enumDefinition[value]!;
      } else {
        throw new Error(`Field ${fieldName} expects a known enum option`);
      }
    } else if (field instanceof BoolField) {
      if (typeof value !== "boolean") {
        throw new Error(`Field ${fieldName} expects a boolean value`);
      }
      encodedValue = value ? 1 : 0;
    } else {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`Field ${fieldName} expects an integer value`);
      }
      encodedValue = value;
    }

    return new WriteSingleRegister(field.address, encodedValue);
  }
}
