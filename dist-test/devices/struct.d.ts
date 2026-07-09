import type { ParsedFieldMap } from "@core/types.js";
import { type EnumDefinition, type DeviceField } from "./field.js";
/**
 * Declarative collection of register-backed telemetry fields.
 */
export declare class DeviceStruct {
    readonly fields: DeviceField[];
    addMany(fields: readonly DeviceField[]): this;
    addUintField(name: string, address: number, range?: readonly [number, number]): this;
    addBoolField(name: string, address: number): this;
    addEnumField<TEnum extends EnumDefinition>(name: string, address: number, enumDefinition: TEnum): this;
    addDecimalField(name: string, address: number, scale: number, range?: readonly [number, number]): this;
    addDecimalArrayField(name: string, address: number, size: number, scale: number): this;
    addStringField(name: string, address: number, size: number): this;
    addSwapStringField(name: string, address: number, size: number): this;
    addVersionField(name: string, address: number): this;
    addSerialNumberField(name: string, address: number): this;
    parse(startingAddress: number, data: Uint8Array): ParsedFieldMap;
}
