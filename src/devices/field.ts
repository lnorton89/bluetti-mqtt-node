import type { DeviceEnumValue, ParsedValue } from "../core/types.js";

/**
 * Mapping between stable enum labels and their 16-bit register values.
 */
export interface EnumDefinition {
  readonly [name: string]: number;
}

/**
 * Resolves a raw enum value while preserving unknown values for diagnostics.
 */
export function enumValue<TEnum extends EnumDefinition>(
  enumDefinition: TEnum,
  rawValue: number,
): DeviceEnumValue {
  for (const [name, value] of Object.entries(enumDefinition)) {
    if (value === rawValue) {
      return { name, value };
    }
  }
  return { name: `UNKNOWN_${rawValue}`, value: rawValue };
}

function readUint16BigEndian(data: Uint8Array, offset: number): number {
  const high = data[offset];
  const low = data[offset + 1];
  if (high === undefined || low === undefined) {
    throw new RangeError(`Missing uint16 bytes at offset ${offset}`);
  }
  return (high << 8) | low;
}

function readAscii(data: Uint8Array): string {
  const terminatorIndex = data.indexOf(0);
  const slice = terminatorIndex >= 0 ? data.subarray(0, terminatorIndex) : data;
  return Buffer.from(slice).toString("ascii");
}

function swapBytePairs(data: Uint8Array): Uint8Array {
  const swapped = data.slice();
  for (let index = 0; index < swapped.length - 1; index += 2) {
    const current = swapped[index];
    const next = swapped[index + 1];
    if (current === undefined || next === undefined) {
      throw new RangeError(`Missing byte while swapping at offset ${index}`);
    }
    swapped[index] = next;
    swapped[index + 1] = current;
  }
  return swapped;
}

/**
 * Base metadata and decoder contract for one logical telemetry field.
 */
export abstract class DeviceField<TValue extends ParsedValue = ParsedValue> {
  readonly name: string;
  readonly address: number;
  readonly size: number;

  protected constructor(name: string, address: number, size: number) {
    this.name = name;
    this.address = address;
    this.size = size;
  }

  abstract parse(data: Uint8Array): TValue;

  isInRange(_value: TValue): boolean {
    return true;
  }
}

/**
 * Unsigned 16-bit register field.
 */
export class UintField extends DeviceField<number> {
  constructor(
    name: string,
    address: number,
    private readonly range?: readonly [number, number],
  ) {
    super(name, address, 1);
  }

  parse(data: Uint8Array): number {
    return readUint16BigEndian(data, 0);
  }

  override isInRange(value: number): boolean {
    return this.range === undefined || (value >= this.range[0] && value <= this.range[1]);
  }
}

/**
 * Boolean field encoded as zero or one in a 16-bit register.
 */
export class BoolField extends DeviceField<boolean> {
  constructor(name: string, address: number) {
    super(name, address, 1);
  }

  parse(data: Uint8Array): boolean {
    return readUint16BigEndian(data, 0) === 1;
  }
}

/**
 * Named enum field backed by a 16-bit register.
 */
export class EnumField<TEnum extends EnumDefinition> extends DeviceField<DeviceEnumValue> {
  constructor(name: string, address: number, readonly enumDefinition: TEnum) {
    super(name, address, 1);
  }

  parse(data: Uint8Array): DeviceEnumValue {
    return enumValue(this.enumDefinition, readUint16BigEndian(data, 0));
  }
}

/**
 * Fixed-point decimal stored in one 16-bit register.
 */
export class DecimalField extends DeviceField<number> {
  constructor(
    name: string,
    address: number,
    private readonly scale: number,
    private readonly range?: readonly [number, number],
  ) {
    super(name, address, 1);
  }

  parse(data: Uint8Array): number {
    return readUint16BigEndian(data, 0) / 10 ** this.scale;
  }

  override isInRange(value: number): boolean {
    return this.range === undefined || (value >= this.range[0] && value <= this.range[1]);
  }
}

/**
 * Fixed-point decimal array spanning consecutive registers.
 */
export class DecimalArrayField extends DeviceField<readonly number[]> {
  constructor(name: string, address: number, size: number, private readonly scale: number) {
    super(name, address, size);
  }

  parse(data: Uint8Array): readonly number[] {
    const values: number[] = [];
    for (let index = 0; index < this.size; index += 1) {
      values.push(readUint16BigEndian(data, index * 2) / 10 ** this.scale);
    }
    return values;
  }
}

/**
 * Null-terminated ASCII string stored in register byte order.
 */
export class StringField extends DeviceField<string> {
  constructor(name: string, address: number, size: number) {
    super(name, address, size);
  }

  parse(data: Uint8Array): string {
    return readAscii(data);
  }
}

/**
 * ASCII string whose bytes are swapped within each register pair.
 */
export class SwapStringField extends DeviceField<string> {
  constructor(name: string, address: number, size: number) {
    super(name, address, size);
  }

  parse(data: Uint8Array): string {
    return readAscii(swapBytePairs(data));
  }
}

/**
 * Two-register firmware version scaled by one hundred.
 */
export class VersionField extends DeviceField<number> {
  constructor(name: string, address: number) {
    super(name, address, 2);
  }

  parse(data: Uint8Array): number {
    const low = readUint16BigEndian(data, 0);
    const high = readUint16BigEndian(data, 2);
    return (low + high * 0x1_0000) / 100;
  }
}

/**
 * Four-register unsigned serial number decoded without precision loss.
 */
export class SerialNumberField extends DeviceField<bigint> {
  constructor(name: string, address: number) {
    super(name, address, 4);
  }

  parse(data: Uint8Array): bigint {
    const word0 = BigInt(readUint16BigEndian(data, 0));
    const word1 = BigInt(readUint16BigEndian(data, 2));
    const word2 = BigInt(readUint16BigEndian(data, 4));
    const word3 = BigInt(readUint16BigEndian(data, 6));
    return word0 + (word1 << 16n) + (word2 << 32n) + (word3 << 48n);
  }
}
