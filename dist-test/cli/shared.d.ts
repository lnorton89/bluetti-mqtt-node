import { DeviceSession } from "@bluetooth/device-session.js";
import type { ReadHoldingRegisters } from "@core/commands.js";
import type { BluettiDevice } from "@devices/device.js";
/**
 * User-facing argument or configuration error.
 *
 * Rendered to stderr with exit code 1 by {@link runCli}.
 *
 * @see runCli
 */
export declare class UsageError extends Error {
}
/**
 * Control-flow error used to print help and exit successfully.
 *
 * Rendered to stdout with exit code 0 by {@link runCli}.
 *
 * @see runCli
 */
export declare class HelpError extends Error {
}
/**
 * Runs work with one initialized device and always releases native resources.
 *
 * @param address - Bluetooth MAC address to connect.
 * @param work - Callback receiving the connected device context.
 * @returns The result of `work`.
 * @throws {Error} When connection or initialization fails.
 *
 * @remarks
 * The original operation error takes precedence over a secondary disconnect
 * failure; successful work still reports disconnect failures to the caller.
 * The helper client is always disposed in the `finally` block.
 *
 * @see ConnectedDeviceContext
 */
export declare function withConnectedDevice<T>(address: string, work: (context: ConnectedDeviceContext) => Promise<T>): Promise<T>;
/**
 * Executes and decodes a list of read commands in order.
 *
 * @param session - Initialized device session.
 * @param device - Device model for field decoding.
 * @param commands - Ordered list of read commands to execute.
 * @returns Array of results containing the command, raw response, and parsed
 *   fields for each read.
 * @throws {BadConnectionError} When the session is lost mid-sequence.
 * @throws {CommandTimeoutError} When a command times out.
 *
 * @see PollCommandResult
 */
export declare function runPollingCommands(session: DeviceSession, device: BluettiDevice, commands: readonly ReadHoldingRegisters[]): Promise<PollCommandResult[]>;
/**
 * Converts BigInt and enum-rich values into JSON-safe output.
 *
 * @param value - Value that may contain `bigint`, enums, or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string` and
 *   enum values become their name.
 *
 * @remarks
 * Also converts `serial_number` and `battery_serial_number` numeric values to
 * strings to preserve formatting in CLI output.
 */
export declare function normalizeValue(value: unknown): unknown;
/**
 * Device objects supplied to a connected CLI operation.
 *
 * @see withConnectedDevice
 */
export interface ConnectedDeviceContext {
    /** Bluetooth MAC address of the connected device. */
    readonly address: string;
    /** Initialized device session for command execution. */
    readonly session: DeviceSession;
    /** Device model for field decoding. */
    readonly device: BluettiDevice;
}
/**
 * Raw and decoded result from one polling command.
 *
 * @see runPollingCommands
 */
export interface PollCommandResult {
    /** The read command that was executed. */
    readonly command: ReadHoldingRegisters;
    /** Raw response bytes from the device. */
    readonly response: Uint8Array;
    /** Decoded field map from parsing the response. */
    readonly parsed: Record<string, unknown>;
}
/**
 * Returns whether standard short or long help flags are present.
 *
 * @param argv - Command-line arguments to check.
 * @returns `true` when `--help` or `-h` is present.
 */
export declare function hasHelpFlag(argv: readonly string[]): boolean;
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
export declare function requireSingleAddressArg(argv: readonly string[], helpText: string): string;
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
export declare function optionalSingleAddressArg(argv: readonly string[], helpText: string): string | undefined;
/**
 * Runs a CLI main function with consistent exit-code and error rendering.
 *
 * @param main - Async entry point for the CLI command.
 *
 * @remarks
 * Catches {@link HelpError} (prints to stdout, exit 0), {@link UsageError}
 * (prints to stderr, exit 1), and all other errors (prints stack to stderr,
 * exit 1). Uses `process.exitCode` rather than `process.exit` so pending I/O
 * can flush.
 */
export declare function runCli(main: () => Promise<void>): void;
/**
 * Installs idempotent SIGINT/SIGTERM cleanup and returns a listener disposer.
 *
 * @param onSignal - Cleanup callback invoked on the first signal.
 * @returns A function that removes the signal handlers.
 *
 * @remarks
 * The handler is idempotent: repeated signals are ignored after the first
 * invocation. Errors from `onSignal` are printed to stderr with exit code 1.
 */
export declare function installSignalHandlers(onSignal: () => void | Promise<void>): () => void;
/**
 * Normalizes accepted MAC formats to uppercase colon-separated notation.
 *
 * @param address - Bluetooth MAC in colon, hyphen, or compact notation.
 * @returns Normalized address in `XX:XX:XX:XX:XX:XX` format.
 * @throws {UsageError} When the address does not match any accepted format.
 */
export declare function validateBluetoothAddress(address: string): string;
