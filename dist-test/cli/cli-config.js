import { readFile } from "node:fs/promises";
import { UsageError } from "./shared.js";
/** Maximum safe `setTimeout` delay in milliseconds (32-bit signed int limit). */
const MAX_TIMER_MS = 2_147_483_647;
/**
 * Returns the value following a flag, or throws when missing or another flag.
 *
 * @param argv - Command-line arguments.
 * @param index - Index of the flag whose value to retrieve.
 * @param helpText - Usage text for the error.
 * @returns The flag value string.
 * @throws {UsageError} When the next argument is missing or starts with `--`.
 */
export function requireValue(argv, index, helpText) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new UsageError(helpText);
    }
    return value;
}
/**
 * Parses an interval string in seconds and converts to milliseconds.
 *
 * @param rawValue - String representation of seconds.
 * @param helpText - Usage text for the error.
 * @returns Interval in milliseconds.
 * @throws {UsageError} When the value is not a valid interval.
 */
export function parseIntervalSeconds(rawValue, helpText) {
    const seconds = Number(rawValue);
    if (!isValidIntervalSeconds(seconds)) {
        throw new UsageError(helpText);
    }
    return seconds * 1000;
}
/**
 * Validates that a seconds value produces a safe `setTimeout` delay.
 *
 * @param seconds - Interval in seconds.
 * @returns `true` when finite, non-negative, integer-millisecond, and within
 *   `MAX_TIMER_MS`.
 */
function isValidIntervalSeconds(seconds) {
    const milliseconds = seconds * 1000;
    return Number.isFinite(seconds)
        && seconds >= 0
        && Number.isSafeInteger(milliseconds)
        && milliseconds <= MAX_TIMER_MS;
}
/**
 * Parses a log-level string into a {@link LogLevel}.
 *
 * @param rawValue - One of `"debug"`, `"info"`, `"warn"`, `"error"`.
 * @param helpText - Usage text for the error.
 * @returns The validated log level.
 * @throws {UsageError} When the value is not a recognized level.
 */
export function parseLogLevel(rawValue, helpText) {
    if (rawValue === "debug" || rawValue === "info" || rawValue === "warn" || rawValue === "error") {
        return rawValue;
    }
    throw new UsageError(helpText);
}
/**
 * Reads and validates config without trusting the shape produced by JSON.parse.
 *
 * @param path - Path to the JSON config file.
 * @returns Validated config object.
 * @throws {UsageError} When the file cannot be read, is not valid JSON, or
 *   contains invalid field values.
 */
export async function readConfigFile(path) {
    let raw;
    try {
        raw = await readFile(path, "utf8");
    }
    catch {
        throw new UsageError(`Failed to read config file '${path}'.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new UsageError(`Config file '${path}' must be valid JSON.`);
    }
    if (typeof parsed !== "object" || parsed === null) {
        throw new UsageError(`Config file '${path}' must contain a JSON object.`);
    }
    const candidate = parsed;
    const config = {};
    if (candidate.broker !== undefined) {
        config.broker = requireConfigString(candidate.broker, path, "broker");
    }
    if (candidate.username !== undefined) {
        config.username = requireConfigString(candidate.username, path, "username");
    }
    if (candidate.password !== undefined) {
        config.password = requireConfigString(candidate.password, path, "password");
    }
    if (candidate.interval !== undefined) {
        if (typeof candidate.interval !== "number" || !isValidIntervalSeconds(candidate.interval)) {
            throw invalidConfigValue(path, "interval");
        }
        config.interval = candidate.interval;
    }
    if (candidate.once !== undefined) {
        if (typeof candidate.once !== "boolean") {
            throw invalidConfigValue(path, "once");
        }
        config.once = candidate.once;
    }
    if (candidate.addresses !== undefined) {
        if (!Array.isArray(candidate.addresses) || !candidate.addresses.every((value) => typeof value === "string")) {
            throw invalidConfigValue(path, "addresses");
        }
        config.addresses = candidate.addresses;
    }
    if (candidate.logLevel !== undefined) {
        if (candidate.logLevel !== "debug"
            && candidate.logLevel !== "info"
            && candidate.logLevel !== "warn"
            && candidate.logLevel !== "error") {
            throw invalidConfigValue(path, "logLevel");
        }
        config.logLevel = candidate.logLevel;
    }
    return config;
}
/**
 * Validates that a config file field is a non-empty string.
 *
 * @param value - Value from the parsed JSON.
 * @param path - Config file path (for error messages).
 * @param field - Field name (for error messages).
 * @returns The validated string.
 * @throws {UsageError} When the value is not a string or is empty/whitespace.
 */
function requireConfigString(value, path, field) {
    if (typeof value !== "string" || value.trim() === "") {
        throw invalidConfigValue(path, field);
    }
    return value;
}
/**
 * Creates a `UsageError` for an invalid config file field value.
 *
 * @param path - Config file path.
 * @param field - Field name.
 * @returns A `UsageError` with a descriptive message.
 */
function invalidConfigValue(path, field) {
    return new UsageError(`Config file '${path}' has an invalid '${field}' value.`);
}
