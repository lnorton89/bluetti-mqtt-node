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
export declare function modbusCrc(data: Uint8Array): number;
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
export declare function appendModbusCrc(data: Uint8Array): Uint8Array;
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
export declare function hasValidModbusCrc(frame: Uint8Array): boolean;
