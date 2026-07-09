import type { LogLevel } from "@core/logger.js";
/** Shape of the JSON config file after validation. */
export interface CliConfigFile {
    /** MQTT broker URL. */
    broker?: string;
    /** MQTT username. */
    username?: string;
    /** MQTT password. */
    password?: string;
    /** Poll interval in seconds. */
    interval?: number;
    /** Whether to run one cycle and exit. */
    once?: boolean;
    /** Bluetooth MAC addresses to poll. */
    addresses?: readonly string[];
    /** Minimum log level. */
    logLevel?: LogLevel;
}
/**
 * Returns the value following a flag, or throws when missing or another flag.
 *
 * @param argv - Command-line arguments.
 * @param index - Index of the flag whose value to retrieve.
 * @param helpText - Usage text for the error.
 * @returns The flag value string.
 * @throws {UsageError} When the next argument is missing or starts with `--`.
 */
export declare function requireValue(argv: readonly string[], index: number, helpText: string): string;
/**
 * Parses an interval string in seconds and converts to milliseconds.
 *
 * @param rawValue - String representation of seconds.
 * @param helpText - Usage text for the error.
 * @returns Interval in milliseconds.
 * @throws {UsageError} When the value is not a valid interval.
 */
export declare function parseIntervalSeconds(rawValue: string, helpText: string): number;
/**
 * Parses a log-level string into a {@link LogLevel}.
 *
 * @param rawValue - One of `"debug"`, `"info"`, `"warn"`, `"error"`.
 * @param helpText - Usage text for the error.
 * @returns The validated log level.
 * @throws {UsageError} When the value is not a recognized level.
 */
export declare function parseLogLevel(rawValue: string, helpText: string): LogLevel;
/**
 * Reads and validates config without trusting the shape produced by JSON.parse.
 *
 * @param path - Path to the JSON config file.
 * @returns Validated config object.
 * @throws {UsageError} When the file cannot be read, is not valid JSON, or
 *   contains invalid field values.
 */
export declare function readConfigFile(path: string): Promise<CliConfigFile>;
