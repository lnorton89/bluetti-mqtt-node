/**
 * Union of value types produced by Bluetti register field decoders.
 *
 * Each concrete {@link DeviceField} subclass narrows this union to the type it
 * emits (e.g. `boolean` for {@link BoolField}, `bigint` for
 * {@link SerialNumberField}).
 *
 * @see DeviceField - base decoder contract
 * @see ParsedFieldMap - keyed collection of decoded values
 */
export type ParsedValue =
  | boolean
  | number
  | string
  | bigint
  | readonly number[]
  | DeviceEnumValue;

/**
 * A decoded enum value that retains both its display name and raw wire value.
 *
 * When the device reports a value not present in the enum definition, the
 * `name` is synthesized as `UNKNOWN_<rawValue>` so callers can still observe
 * and log unexpected states.
 */
export interface DeviceEnumValue {
  /** Human-readable enum label, or `UNKNOWN_<value>` for unmapped codes. */
  readonly name: string;
  /** Raw 16-bit register value as read from the device. */
  readonly value: number;
}

/**
 * Decoded telemetry values keyed by stable field name.
 *
 * Produced by {@link DeviceStruct.parse}. Only fields whose register span is
 * fully covered by the read window and whose optional plausibility range
 * accepts the decoded value are included.
 *
 * @see DeviceStruct.parse
 */
export type ParsedFieldMap = Record<string, ParsedValue>;

/**
 * Half-open register-address range that a device model permits writing.
 *
 * A register address `A` is writable when `range.start <= A < range.endExclusive`.
 * Models expose their writable ranges via {@link BluettiDevice.writableRanges}.
 *
 * @see BluettiDevice.writableRanges
 * @see isAddressWritable
 */
export interface WritableRange {
  /** First writable register address (inclusive). */
  readonly start: number;
  /** Address one past the last writable register (exclusive). */
  readonly endExclusive: number;
}

/**
 * Returns whether a register address belongs to at least one writable range.
 *
 * @param address - Register address to test.
 * @param ranges - Writable ranges declared by the device model.
 * @returns `true` when `address` falls inside any range's half-open span.
 *
 * @example
 * ```ts
 * const ranges = [{ start: 3000, endExclusive: 3062 }];
 * isAddressWritable(3007, ranges); // true
 * isAddressWritable(99, ranges);   // false
 * ```
 */
export function isAddressWritable(address: number, ranges: readonly WritableRange[]): boolean {
  return ranges.some((range) => address >= range.start && address < range.endExclusive);
}
