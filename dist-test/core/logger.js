/** Numeric priority for each log level (lower = more verbose). */
const LOG_LEVEL_PRIORITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
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
export class ConsoleLogger {
    minimumLevel;
    /**
     * Creates a logger that suppresses messages below `minimumLevel`.
     *
     * @param minimumLevel - Lowest severity to emit (default `"info"`).
     */
    constructor(minimumLevel = "info") {
        this.minimumLevel = minimumLevel;
    }
    /** @inheritdoc */
    debug(message, context) {
        this.write("debug", message, context);
    }
    /** @inheritdoc */
    info(message, context) {
        this.write("info", message, context);
    }
    /** @inheritdoc */
    warn(message, context) {
        this.write("warn", message, context);
    }
    /** @inheritdoc */
    error(message, context) {
        this.write("error", message, context);
    }
    /**
     * Writes a single JSON log line if the level passes the threshold.
     *
     * @param level - Severity of this message.
     * @param message - Human-readable summary.
     * @param context - Optional structured key/value pairs.
     */
    write(level, message, context) {
        if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minimumLevel]) {
            return;
        }
        const payload = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };
        if (context !== undefined && Object.keys(context).length > 0) {
            payload.context = normalizeLogValue(context);
        }
        const line = JSON.stringify(payload);
        if (level === "warn") {
            console.warn(line);
            return;
        }
        if (level === "error") {
            console.error(line);
            return;
        }
        console.log(line);
    }
}
/**
 * Recursively normalizes a value for JSON serialization.
 *
 * @param value - Value that may contain `bigint` or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string`.
 */
function normalizeLogValue(value) {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeLogValue(entry));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeLogValue(entry)]));
    }
    return value;
}
