import {
	AT_CONTROL_ADV_MESSAGE,
	AT_CONTROL_NAME_MESSAGE,
	GATT_FAILED_UNREACHABLE_TEXT,
	GATT_UNREACHABLE_TEXT,
	UNREACHABLE_ERROR_TEXT,
} from "./constants.js";
import { BadConnectionError } from "./errors.js";

/**
 * Returns whether an initialization error is worth retrying.
 *
 * @param error - Error from a failed connect/initialize attempt.
 * @returns `true` when the error message indicates a transient GATT
 *   "unreachable" condition.
 *
 * @remarks
 * Windows can report `unreachable` when the GATT service enumeration races
 * with device advertisement caching. Retrying after a short delay usually
 * succeeds.
 */
export function isRetryableInitializationError(error: unknown): boolean {
	if (error instanceof BadConnectionError) {
		return true;
	}

	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return (
		normalized.includes(GATT_UNREACHABLE_TEXT) ||
		normalized.includes(GATT_FAILED_UNREACHABLE_TEXT) ||
		normalized.includes(UNREACHABLE_ERROR_TEXT)
	);
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 *
 * @param ms - Delay in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Concatenates two byte arrays into a new allocation.
 *
 * @param left - First byte array.
 * @param right - Second byte array.
 * @returns A new `Uint8Array` containing `left` followed by `right`.
 */
export function concatBytes(
	left: Uint8Array,
	right: Uint8Array,
): Uint8Array<ArrayBufferLike> {
	const combined = new Uint8Array(new ArrayBuffer(left.length + right.length));
	combined.set(left, 0);
	combined.set(right, left.length);
	return combined;
}

/**
 * Detects Bluetti AT control messages that arrive on the notification channel.
 *
 * @param data - Raw notification bytes.
 * @returns `true` when the payload decodes to `AT+NAME?\r` or `AT+ADV?\r`,
 *   which indicates the device is responding to BLE management commands rather
 *   than MODBUS requests.
 */
export function isAsciiControlMessage(data: Uint8Array): boolean {
	const text = Buffer.from(data).toString("ascii");
	return text === AT_CONTROL_NAME_MESSAGE || text === AT_CONTROL_ADV_MESSAGE;
}
