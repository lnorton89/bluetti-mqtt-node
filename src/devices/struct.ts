import type { ParsedFieldMap } from "@core/types.js";
import {
  BoolField,
  DecimalArrayField,
  DecimalField,
  EnumField,
  type EnumDefinition,
  SerialNumberField,
  StringField,
  SwapStringField,
  UintField,
  VersionField,
  type DeviceField,
} from "./field.js";

/**
 * Declarative collection of register-backed telemetry fields.
 */
export class DeviceStruct {
  readonly fields: DeviceField[] = [];

  addMany(fields: readonly DeviceField[]): this {
    for (const field of fields) {
      this.fields.push(field);
    }
    return this;
  }

  addUintField(name: string, address: number, range?: readonly [number, number]): this {
    this.fields.push(new UintField(name, address, range));
    return this;
  }

  addBoolField(name: string, address: number): this {
    this.fields.push(new BoolField(name, address));
    return this;
  }

  addEnumField<TEnum extends EnumDefinition>(name: string, address: number, enumDefinition: TEnum): this {
    this.fields.push(new EnumField(name, address, enumDefinition));
    return this;
  }

  addDecimalField(
    name: string,
    address: number,
    scale: number,
    range?: readonly [number, number],
  ): this {
    this.fields.push(new DecimalField(name, address, scale, range));
    return this;
  }

  addDecimalArrayField(name: string, address: number, size: number, scale: number): this {
    this.fields.push(new DecimalArrayField(name, address, size, scale));
    return this;
  }

  addStringField(name: string, address: number, size: number): this {
    this.fields.push(new StringField(name, address, size));
    return this;
  }

  addSwapStringField(name: string, address: number, size: number): this {
    this.fields.push(new SwapStringField(name, address, size));
    return this;
  }

  addVersionField(name: string, address: number): this {
    this.fields.push(new VersionField(name, address));
    return this;
  }

  addSerialNumberField(name: string, address: number): this {
    this.fields.push(new SerialNumberField(name, address));
    return this;
  }

  parse(startingAddress: number, data: Uint8Array): ParsedFieldMap {
    if (data.length % 2 !== 0) {
      throw new RangeError(`Register data length must be even, got ${data.length}`);
    }

    const registerCount = data.length / 2;
    const registerRangeStart = startingAddress;
    const registerRangeEndExclusive = startingAddress + registerCount;
    const parsed: ParsedFieldMap = {};

    for (const field of this.fields) {
      const fieldEndExclusive = field.address + field.size;
      if (field.address < registerRangeStart || fieldEndExclusive > registerRangeEndExclusive) {
        continue;
      }

      const byteStart = (field.address - startingAddress) * 2;
      const byteEnd = byteStart + field.size * 2;
      const value = field.parse(data.slice(byteStart, byteEnd));
      if (field.isInRange(value)) {
        parsed[field.name] = value;
      }
    }

    return parsed;
  }
}
