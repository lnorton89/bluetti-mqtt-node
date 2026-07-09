/**
 * Structured-log severity levels ordered from verbose to fatal.
 *
 * Priority ordering: `debug` (10) < `info` (20) < `warn` (30) < `error` (40).
 * Messages below the logger's minimum level are suppressed.
 *
 * @see ConsoleLogger
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
/**
 * Logging contract shared by runtime components and test doubles.
 *
 * Every method accepts a human-readable `message` and an optional structured
 * `context` object whose values are normalized for JSON serialization.
 *
 * @see ConsoleLogger
 */
export interface Logger {
    /**
     * Emits a debug-level message.
     *
     * @param message - Human-readable summary.
     * @param context - Optional structured key/value pairs.
     */
    debug(message: string, context?: Record<string, unknown>): void;
    /**
     * Emits an info-level message.
     *
     * @param message - Human-readable summary.
     * @param context - Optional structured key/value pairs.
     */
    info(message: string, context?: Record<string, unknown>): void;
    /**
     * Emits a warn-level message.
     *
     * @param message - Human-readable summary.
     * @param context - Optional structured key/value pairs.
     */
    warn(message: string, context?: Record<string, unknown>): void;
    /**
     * Emits an error-level message.
     *
     * @param message - Human-readable summary.
     * @param context - Optional structured key/value pairs.
     */
    error(message: string, context?: Record<string, unknown>): void;
}
/**
 * Emits one structured JSON record per line to stdout or stderr.
 *
 * Each log call produces a single JSON object with `timestamp`, `level`,
 * `message`, and optional `context` fields. `warn` and `error` levels write to
 * `stderr`; `debug` and `info` write to `stdout`.
 *
 * @remarks
 * `bigint` values in context are serialized as strings so the output is valid
 * JSON (JSON does not support BigInt). Nested objects and arrays are
 * recursively normalized.
 *
 * @example
 * ```ts
 * const logger = new ConsoleLogger("debug");
 * logger.info("Device connected", { address: "24:4C:AB:2C:24:8E" });
 * // stdout: {"timestamp":"2024-01-01T00:00:00.000Z","level":"info","message":"Device connected","context":{"address":"24:4C:AB:2C:24:8E"}}
 * ```
 */
export declare class ConsoleLogger implements Logger {
    private readonly minimumLevel;
    /**
     * Creates a logger that suppresses messages below `minimumLevel`.
     *
     * @param minimumLevel - Lowest severity to emit (default `"info"`).
     */
    constructor(minimumLevel?: LogLevel);
    /** @inheritdoc */
    debug(message: string, context?: Record<string, unknown>): void;
    /** @inheritdoc */
    info(message: string, context?: Record<string, unknown>): void;
    /** @inheritdoc */
    warn(message: string, context?: Record<string, unknown>): void;
    /** @inheritdoc */
    error(message: string, context?: Record<string, unknown>): void;
    /**
     * Writes a single JSON log line if the level passes the threshold.
     *
     * @param level - Severity of this message.
     * @param message - Human-readable summary.
     * @param context - Optional structured key/value pairs.
     */
    private write;
}
