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
export function isAddressWritable(address, ranges) {
    return ranges.some((range) => address >= range.start && address < range.endExclusive);
}
