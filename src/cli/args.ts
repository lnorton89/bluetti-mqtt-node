import {
	HELP_LONG_FLAG,
	HELP_SHORT_FLAG,
	MAC_COLON_PATTERN,
	MAC_COMPACT_PATTERN,
	MAC_HYPHEN_PATTERN,
} from "./constants.js";
import { HelpError, UsageError } from "./errors.js";

/**
 * Returns whether standard short or long help flags are present.
 *
 * @param argv - Command-line arguments to check.
 * @returns `true` when `--help` or `-h` is present.
 */
export function hasHelpFlag(argv: readonly string[]): boolean {
	return argv.includes(HELP_LONG_FLAG) || argv.includes(HELP_SHORT_FLAG);
}

/**
 * Requires exactly one validated Bluetooth address argument.
 *
 * @param argv - Command-line arguments (excluding the executable).
 * @param helpText - Usage text shown on error.
 * @returns The validated, normalized Bluetooth address.
 * @throws {HelpError} When `--help` or `-h` is present.
 * @throws {UsageError} When the argument count is wrong or the address is
 *   invalid.
 *
 * @see validateBluetoothAddress
 */
export function requireSingleAddressArg(
	argv: readonly string[],
	helpText: string,
): string {
	if (hasHelpFlag(argv)) {
		throw new HelpError(helpText);
	}

	if (argv.length !== 1 || !argv[0]) {
		throw new UsageError(helpText);
	}

	return validateBluetoothAddress(argv[0]);
}

/**
 * Accepts zero or one validated Bluetooth address argument.
 *
 * @param argv - Command-line arguments (excluding the executable).
 * @param helpText - Usage text shown on error.
 * @returns The validated address, or `undefined` when no argument is given.
 * @throws {HelpError} When `--help` or `-h` is present.
 * @throws {UsageError} When more than one argument is given or the address is
 *   invalid.
 *
 * @see validateBluetoothAddress
 */
export function optionalSingleAddressArg(
	argv: readonly string[],
	helpText: string,
): string | undefined {
	if (hasHelpFlag(argv)) {
		throw new HelpError(helpText);
	}

	if (argv.length > 1) {
		throw new UsageError(helpText);
	}

	return argv[0] ? validateBluetoothAddress(argv[0]) : undefined;
}

/**
 * Normalizes accepted MAC formats to uppercase colon-separated notation.
 *
 * @param address - Bluetooth MAC in colon, hyphen, or compact notation.
 * @returns Normalized address in `XX:XX:XX:XX:XX:XX` format.
 * @throws {UsageError} When the address does not match any accepted format.
 */
export function validateBluetoothAddress(address: string): string {
	const normalized = address.trim().toUpperCase();
	const patterns = [MAC_COLON_PATTERN, MAC_HYPHEN_PATTERN, MAC_COMPACT_PATTERN];

	if (!patterns.some((pattern) => pattern.test(normalized))) {
		throw new UsageError(
			`Invalid Bluetooth address '${address}'. Expected 12 hex digits, for example 24:4C:AB:2C:24:8E.`,
		);
	}

	if (normalized.includes(":")) {
		return normalized;
	}

	const compact = normalized.replace(/-/g, "");
	return compact.match(/.{2}/g)?.join(":") ?? normalized;
}

/**
 * Converts BigInt and enum-rich values into JSON-safe output.
 *
 * @param value - Value that may contain `bigint`, enums, or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string` and
 *   enum values become their name.
 *
 * @remarks
 * CLI printer variant — sibling of `@broker/client.ts normalizeValue`.
 * Kept divergent on purpose: this version also coerces `serial_number` and
 * `battery_serial_number` numeric fields to strings so CLI output preserves
 * their formatting.
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
			const candidate = value as { name: unknown };
			if (typeof candidate.name === "string") {
				return candidate.name;
			}
		}

		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
				if (
					(key === "serial_number" || key === "battery_serial_number") &&
					typeof entry === "number"
				) {
					return [key, String(entry)];
				}

				return [key, normalizeValue(entry)];
			}),
		);
	}

	return value;
}
