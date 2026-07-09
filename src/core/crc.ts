import { CRC_INITIAL_VALUE, CRC_POLYNOMIAL } from "./constants.js";

/** MODBUS CRC-16 polynomial (bit-reversed `0x8005`). */
const MODBUS_POLYNOMIAL = CRC_POLYNOMIAL;

/**
 * Calculates the MODBUS CRC-16 checksum for a byte sequence.
 *
 * Uses the standard MODBUS polynomial `0xA001` (bit-reversed `0x8005`) with an
 * initial value of `0xFFFF`.
 *
 * @param data - Bytes over which to compute the checksum.
 * @returns The 16-bit CRC value (low byte first when appended to a frame).
 *
 * @remarks
 * The CRC is computed LSB-first, matching the MODBUS RTU specification. When
 * appending to a frame, the low byte is written before the high byte — see
 * {@link appendModbusCrc}.
 *
 * @example
 * ```ts
 * const crc = modbusCrc(new Uint8Array([0x01, 0x03, 0x00, 0x0a, 0x00, 0x28]));
 * ```
 *
 * @see appendModbusCrc
 * @see hasValidModbusCrc
 */
export function modbusCrc(data: Uint8Array): number {
	let crc = CRC_INITIAL_VALUE;

	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			const lsb = crc & 0x0001;
			crc >>= 1;
			if (lsb !== 0) {
				crc ^= MODBUS_POLYNOMIAL;
			}
		}
	}

	return crc & 0xffff;
}

/**
 * Returns a copy of a frame body with its low-byte-first CRC appended.
 *
 * @param data - Frame body (without CRC).
 * @returns A new `Uint8Array` of length `data.length + 2` containing the body
 *   followed by the CRC low byte then high byte.
 *
 * @example
 * ```ts
 * const body = new Uint8Array([0x01, 0x03, 0x00, 0x0a]);
 * const frame = appendModbusCrc(body); // [0x01, 0x03, 0x00, 0x0a, crcLo, crcHi]
 * ```
 *
 * @see modbusCrc
 */
export function appendModbusCrc(data: Uint8Array): Uint8Array {
	const crc = modbusCrc(data);
	const result = new Uint8Array(data.length + 2);
	result.set(data, 0);
	result[result.length - 2] = crc & 0xff;
	result[result.length - 1] = (crc >> 8) & 0xff;
	return result;
}

/**
 * Tests whether a complete MODBUS RTU frame carries the expected CRC.
 *
 * @param frame - Complete frame including the trailing two CRC bytes.
 * @returns `true` when the computed CRC of `frame[0..n-2]` matches the final
 *   two bytes. Returns `false` for frames shorter than 3 bytes.
 *
 * @example
 * ```ts
 * if (hasValidModbusCrc(response)) {
 *   // safe to process the frame
 * }
 * ```
 *
 * @see modbusCrc
 */
export function hasValidModbusCrc(frame: Uint8Array): boolean {
	if (frame.length < 3) {
		return false;
	}

	const expected = modbusCrc(frame.subarray(0, -2));
	const low = frame[frame.length - 2];
	const high = frame[frame.length - 1];
	return low === (expected & 0xff) && high === ((expected >> 8) & 0xff);
}
