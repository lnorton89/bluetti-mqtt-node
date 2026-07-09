import type { DeviceEnumValue } from "@core/types.js";
import type { BluettiDevice } from "@devices/device.js";
import {
	BOOLEAN_OFF_VALUE,
	BOOLEAN_ON_VALUE,
	INTEGER_PAYLOAD_PATTERN,
} from "./constants.js";

/**
 * Converts a parsed field value to its MQTT string representation.
 *
 * @param value - Value to serialize (boolean, bigint, array, enum, or number/string).
 * @returns `"ON"`/`"OFF"` for booleans, string for bigints, JSON for arrays,
 *   enum name for enum values, or `String(value)` otherwise.
 */
export function serializeValue(value: unknown): string {
	if (typeof value === "boolean") {
		return value ? BOOLEAN_ON_VALUE : BOOLEAN_OFF_VALUE;
	}

	if (typeof value === "bigint") {
		return value.toString();
	}

	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}

	if (
		value &&
		typeof value === "object" &&
		"name" in value &&
		"value" in value
	) {
		const enumValue = value as DeviceEnumValue;
		return enumValue.name;
	}

	return String(value);
}

/**
 * Parses an MQTT command payload string into a typed value.
 *
 * @param payload - Raw string payload (`"ON"`, `"OFF"`, numeric, or string).
 * @returns `true`/`false` for ON/OFF, `number` for integers, or the raw string.
 */
export function parseCommandValue(payload: string): boolean | number | string {
	if (payload === BOOLEAN_ON_VALUE) {
		return true;
	}
	if (payload === BOOLEAN_OFF_VALUE) {
		return false;
	}
	if (INTEGER_PAYLOAD_PATTERN.test(payload)) {
		return Number(payload);
	}
	return payload;
}

/**
 * Recursively normalizes a parsed field map for JSON publication.
 *
 * @param record - Raw parsed field map.
 * @returns A JSON-safe object where bigints become strings and enums become names.
 */
export function normalizeRecord(
	record: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]),
	);
}

/**
 * Recursively normalizes a single value for JSON publication.
 *
 * @param value - Value that may contain `bigint`, enums, or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string` and
 *   enum values become their name.
 *
 * @remarks
 * Broker publisher variant — sibling of `@cli/args.ts normalizeValue`.
 * Kept divergent on purpose: this version does NOT coerce
 * `serial_number`/`battery_serial_number` numeric fields to string — the
 * `_raw` JSON snapshot is consumed by clients that expect numeric types.
 */
export function normalizeValue(value: unknown): unknown {
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map((entry) => normalizeValue(entry));
	}
	if (value && typeof value === "object") {
		if ("name" in value && "value" in value) {
			const enumValue = value as DeviceEnumValue;
			return enumValue.name;
		}
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
				key,
				normalizeValue(entry),
			]),
		);
	}
	return value;
}

/**
 * Returns the `MODEL-SERIAL` composite key for a device.
 *
 * @param device - Device to key.
 * @returns `${device.type}-${device.serialNumber}`.
 */
export function deviceKey(device: BluettiDevice): string {
	return `${device.type}-${device.serialNumber}`;
}

/**
 * Extracts a display string from an unknown error value.
 *
 * @param error - Value to stringify.
 * @returns `error.message` for `Error` instances, otherwise `String(error)`.
 */
export function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
