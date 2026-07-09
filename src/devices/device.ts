import {
	type ReadHoldingRegisters,
	WriteSingleRegister,
} from "@core/commands.js";
import { isAddressWritable, type WritableRange } from "@core/types.js";
import { BoolField, EnumField } from "./field.js";
import type { DeviceStruct } from "./struct.js";

/**
 * Base model for a supported Bluetti product family.
 *
 * @remarks
 * Subclasses declare register windows and writable ranges by overriding the
 * abstract and virtual getters (`pollingCommands`, `loggingCommands`,
 * `writableRanges`, etc.). The struct is built in a private factory function
 * per model using the fluent {@link DeviceStruct} builder.
 *
 * Setter construction via {@link BluettiDevice.buildSetterCommand} validates
 * field type and address ownership before producing a command, ensuring that
 * only writable fields within declared ranges can be written.
 *
 * @example
 * ```ts
 * const device = createDeviceFromAdvertisement(address, "AC500-2237000003358");
 * const cmd = device.buildSetterCommand("ac_output_on", true);
 * await session.perform(cmd);
 * ```
 *
 * @see DeviceStruct
 * @see createDeviceFromAdvertisement
 */
export abstract class BluettiDevice {
	/** Bluetooth MAC address of the physical device. */
	readonly address: string;
	/** Model family name (e.g. `"AC500"`, `"EB3A"`). */
	readonly type: string;
	/** Numeric serial number parsed from the advertisement name. */
	readonly serialNumber: string;
	/** Register field schema for this device model. */
	readonly struct: DeviceStruct;

	/**
	 * Creates a device model instance.
	 *
	 * @param address - Bluetooth MAC address.
	 * @param type - Model family identifier.
	 * @param serialNumber - Numeric serial string from the advertisement.
	 * @param struct - Pre-built register field schema.
	 */
	protected constructor(
		address: string,
		type: string,
		serialNumber: string,
		struct: DeviceStruct,
	) {
		this.address = address;
		this.type = type;
		this.serialNumber = serialNumber;
		this.struct = struct;
	}

	/**
	 * Decodes one register window through the model schema.
	 *
	 * @param address - Starting register address of the read.
	 * @param data - Raw register payload bytes (length must be even).
	 * @returns Decoded field map for fields fully covered by the window.
	 *
	 * @see DeviceStruct.parse
	 */
	parse(address: number, data: Uint8Array) {
		return this.struct.parse(address, data);
	}

	/**
	 * Number of battery-pack slots addressable by this model.
	 *
	 * @returns Maximum pack count (default `1`). Models with multiple packs
	 *   override this getter.
	 */
	get packNumMax(): number {
		return 1;
	}

	/**
	 * Complete register windows used by one full telemetry cycle.
	 *
	 * @returns Ordered list of {@link ReadHoldingRegisters} for full polling.
	 */
	abstract get pollingCommands(): readonly ReadHoldingRegisters[];

	/**
	 * Leading live-state window used by high-frequency cycles.
	 *
	 * @returns The first element(s) of {@link pollingCommands}. Default returns
	 *   the first command only.
	 *
	 * @remarks
	 * Fast polling reads only this subset to minimize latency on the live
	 * power/state window. Slow commands (configuration, battery-pack detail) are
	 * deferred to full cycles.
	 */
	get fastPollingCommands(): readonly ReadHoldingRegisters[] {
		return this.pollingCommands.slice(0, 1);
	}

	/**
	 * Remaining lower-frequency windows used by full cycles.
	 *
	 * @returns All polling commands after the fast subset.
	 */
	get slowPollingCommands(): readonly ReadHoldingRegisters[] {
		return this.pollingCommands.slice(this.fastPollingCommands.length);
	}

	/**
	 * Optional per-battery-pack register windows.
	 *
	 * @returns Pack-specific read commands (default empty). Models with multiple
	 *   packs override this.
	 */
	get packPollingCommands(): readonly ReadHoldingRegisters[] {
		return [];
	}

	/**
	 * Register windows used by the diagnostic logger CLI.
	 *
	 * @returns Ordered list of read commands for the logging command set.
	 */
	abstract get loggingCommands(): readonly ReadHoldingRegisters[];

	/**
	 * Optional pack windows used by the diagnostic logger.
	 *
	 * @returns Pack-specific logging commands (default empty).
	 */
	get packLoggingCommands(): readonly ReadHoldingRegisters[] {
		return [];
	}

	/**
	 * Writable register ranges for this model.
	 *
	 * @returns Half-open address ranges that may be written (default empty).
	 *   Models with writable controls override this.
	 *
	 * @see WritableRange
	 * @see isAddressWritable
	 */
	get writableRanges(): readonly WritableRange[] {
		return [];
	}

	/**
	 * Returns whether the model schema contains a field name.
	 *
	 * @param fieldName - Field name to look up.
	 * @returns `true` when a field with that name exists in the struct.
	 */
	hasField(fieldName: string): boolean {
		return this.struct.fields.some((field) => field.name === fieldName);
	}

	/**
	 * Returns whether metadata and writable ranges permit changing a field.
	 *
	 * @param fieldName - Field name to check.
	 * @returns `true` when the field exists **and** its address falls within a
	 *   writable range.
	 *
	 * @see isAddressWritable
	 */
	hasFieldSetter(fieldName: string): boolean {
		return this.struct.fields.some(
			(field) =>
				field.name === fieldName &&
				isAddressWritable(field.address, this.writableRanges),
		);
	}

	/**
	 * Builds a validated single-register setter for a writable field.
	 *
	 * @param fieldName - Name of the writable field to set.
	 * @param value - Value to write (`boolean` for bool fields, `number` or enum
	 *   name `string` for enum fields, `number` for uint fields).
	 * @returns A {@link WriteSingleRegister} targeting the field's register address.
	 * @throws {Error} When the field is not writable on this model.
	 * @throws {Error} When the value type does not match the field type.
	 * @throws {Error} When an enum name is not found in the field's definition.
	 *
	 * @remarks
	 * For enum fields, `value` may be a known enum name (string) or the raw
	 * numeric value. For bool fields, `value` must be a boolean. For uint
	 * fields, `value` must be an integer.
	 */
	buildSetterCommand(
		fieldName: string,
		value: boolean | number | string,
	): WriteSingleRegister {
		const field = this.struct.fields.find(
			(candidate) =>
				candidate.name === fieldName &&
				isAddressWritable(candidate.address, this.writableRanges),
		);
		if (field === undefined) {
			throw new Error(`Field ${fieldName} is not writable on ${this.type}`);
		}

		let encodedValue: number;
		if (field instanceof EnumField) {
			if (typeof value === "number") {
				encodedValue = value;
			} else if (
				typeof value === "string" &&
				field.enumDefinition[value] !== undefined
			) {
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
