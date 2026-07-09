import type { DeviceEnumValue, ParsedValue } from "@core/types.js";
/**
 * Mapping between stable enum labels and their 16-bit register values.
 */
export interface EnumDefinition {
    readonly [name: string]: number;
}
/**
 * Resolves a raw enum value while preserving unknown values for diagnostics.
 */
export declare function enumValue<TEnum extends EnumDefinition>(enumDefinition: TEnum, rawValue: number): DeviceEnumValue;
/**
 * Base metadata and decoder contract for one logical telemetry field.
 */
export declare abstract class DeviceField<TValue extends ParsedValue = ParsedValue> {
    readonly name: string;
    readonly address: number;
    readonly size: number;
    protected constructor(name: string, address: number, size: number);
    abstract parse(data: Uint8Array): TValue;
    isInRange(_value: TValue): boolean;
}
/**
 * Unsigned 16-bit register field.
 */
export declare class UintField extends DeviceField<number> {
    private readonly range?;
    constructor(name: string, address: number, range?: readonly [number, number] | undefined);
    parse(data: Uint8Array): number;
    isInRange(value: number): boolean;
}
/**
 * Boolean field encoded as zero or one in a 16-bit register.
 */
export declare class BoolField extends DeviceField<boolean> {
    constructor(name: string, address: number);
    parse(data: Uint8Array): boolean;
}
/**
 * Named enum field backed by a 16-bit register.
 */
export declare class EnumField<TEnum extends EnumDefinition> extends DeviceField<DeviceEnumValue> {
    readonly enumDefinition: TEnum;
    constructor(name: string, address: number, enumDefinition: TEnum);
    parse(data: Uint8Array): DeviceEnumValue;
}
/**
 * Fixed-point decimal stored in one 16-bit register.
 */
export declare class DecimalField extends DeviceField<number> {
    private readonly scale;
    private readonly range?;
    constructor(name: string, address: number, scale: number, range?: readonly [number, number] | undefined);
    parse(data: Uint8Array): number;
    isInRange(value: number): boolean;
}
/**
 * Fixed-point decimal array spanning consecutive registers.
 */
export declare class DecimalArrayField extends DeviceField<readonly number[]> {
    private readonly scale;
    constructor(name: string, address: number, size: number, scale: number);
    parse(data: Uint8Array): readonly number[];
}
/**
 * Null-terminated ASCII string stored in register byte order.
 */
export declare class StringField extends DeviceField<string> {
    constructor(name: string, address: number, size: number);
    parse(data: Uint8Array): string;
}
/**
 * ASCII string whose bytes are swapped within each register pair.
 */
export declare class SwapStringField extends DeviceField<string> {
    constructor(name: string, address: number, size: number);
    parse(data: Uint8Array): string;
}
/**
 * Two-register firmware version scaled by one hundred.
 */
export declare class VersionField extends DeviceField<number> {
    constructor(name: string, address: number);
    parse(data: Uint8Array): number;
}
/**
 * Four-register unsigned serial number decoded without precision loss.
 */
export declare class SerialNumberField extends DeviceField<bigint> {
    constructor(name: string, address: number);
    parse(data: Uint8Array): bigint;
}
