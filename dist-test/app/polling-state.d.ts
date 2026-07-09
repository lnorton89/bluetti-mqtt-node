/**
 * Types, constants, and pure helper functions for adaptive device polling.
 *
 * @remarks
 * This module is intentionally free of side effects and class state. It
 * contains the data structures and pure functions that describe and manipulate
 * the polling schedule, leaving the orchestration to {@link DeviceHandler}.
 *
 * @see DeviceHandler
 */
/**
 * Timing and adaptive-backoff limits for device polling.
 *
 * All values are in milliseconds. Unset fields fall back to the defaults in
 * {@link DEFAULT_POLLING_OPTIONS}.
 *
 * @see DeviceHandler
 */
export interface PollingOptions {
    /** Interval between fast polling cycles (live power/state window). */
    readonly fastIntervalMs?: number;
    /** Interval between full polling cycles (all register windows). */
    readonly fullIntervalMs?: number;
    /** Delay between consecutive commands within one polling cycle. */
    readonly commandDelayMs?: number;
    /** Additional interval added per busy response before retrying. */
    readonly busyPenaltyMs?: number;
    /** Amount subtracted from intervals on each successful recovery step. */
    readonly recoveryStepMs?: number;
    /** Upper clamp for the fast polling interval during backoff. */
    readonly maxFastIntervalMs?: number;
    /** Upper clamp for the full polling interval during backoff. */
    readonly maxFullIntervalMs?: number;
    /** Upper clamp for the inter-command delay during backoff. */
    readonly maxCommandDelayMs?: number;
}
/**
 * Mutable per-device polling schedule state, adjusted by adaptive backoff.
 *
 * @see DeviceHandler
 */
export interface DevicePollingState {
    /** Timestamp (ms epoch) when the next fast cycle may start. */
    nextFastPollAt: number;
    /** Timestamp (ms epoch) when the next full cycle may start. */
    nextFullPollAt: number;
    /** Current fast-cycle interval, subject to adaptive backoff. */
    fastIntervalMs: number;
    /** Current full-cycle interval, subject to adaptive backoff. */
    fullIntervalMs: number;
    /** Current inter-command delay, subject to adaptive backoff. */
    commandDelayMs: number;
}
/**
 * Accumulated per-device telemetry counters and timestamps for diagnostics.
 *
 * @see DeviceHandler
 */
export interface DeviceTelemetry {
    /** Total number of polling cycles (fast + full). */
    cycleCount: number;
    /** Number of fast polling cycles executed. */
    fastCycleCount: number;
    /** Number of full polling cycles executed. */
    fullCycleCount: number;
    /** Number of commands that completed successfully. */
    successfulCommandCount: number;
    /** Number of expected errors (timeout, MODBUS, parse) encountered. */
    expectedErrorCount: number;
    /** Number of MODBUS busy responses received. */
    busyErrorCount: number;
    /** Number of external write commands dispatched via the event bus. */
    commandWriteCount: number;
    /** Number of parser messages published to the event bus. */
    parserPublishCount: number;
    /** Cumulative duration of all polling cycles in milliseconds. */
    totalCycleDurationMs: number;
    /** Cumulative duration of all successful commands in milliseconds. */
    totalCommandDurationMs: number;
    /** Longest single polling cycle duration in milliseconds. */
    maxCycleDurationMs: number;
    /** Longest single command duration in milliseconds. */
    maxCommandDurationMs: number;
    /** ISO timestamp of the last cycle start, or `null` if none yet. */
    lastCycleStartedAt: string | null;
    /** ISO timestamp of the last cycle completion, or `null` if none yet. */
    lastCycleCompletedAt: string | null;
    /** ISO timestamp of the last busy response, or `null` if none yet. */
    lastBusyAt: string | null;
    /** ISO timestamp of the last error, or `null` if none yet. */
    lastErrorAt: string | null;
    /** Timestamp (ms epoch) of the last busy warning log. */
    lastBusyWarningAtMs: number;
    /** Count of busy warnings suppressed since the last logged warning. */
    suppressedBusyWarningCount: number;
    /** Timestamp (ms epoch) of the last telemetry summary log. */
    lastSummaryAtMs: number;
}
/**
 * Outcome of executing a single command or command set.
 *
 * - `"ok"` — completed successfully.
 * - `"expected_error"` — a recoverable error occurred (timeout, MODBUS, parse).
 * - `"busy"` — the device reported MODBUS busy; backoff should be applied.
 * - `"connection_error"` — the BLE link is broken; reconnect is needed.
 *
 * @see DeviceHandler.executeReadCommand
 * @see DeviceHandler.runCommandSet
 */
export type CommandResult = "ok" | "expected_error" | "busy" | "connection_error";
/** Default polling options used when no values are supplied. */
export declare const DEFAULT_POLLING_OPTIONS: Required<PollingOptions>;
/** Minimum interval between telemetry summary log entries (60 seconds). */
export declare const TELEMETRY_SUMMARY_INTERVAL_MS = 60000;
/** Minimum interval between busy-warning log entries (60 seconds). */
export declare const BUSY_WARNING_INTERVAL_MS = 60000;
/** Delay between startup or reconnect retry attempts (5 seconds). */
export declare const STARTUP_RETRY_DELAY_MS = 5000;
/**
 * Normalizes the constructor's interval-or-options argument into a complete
 * {@link Required<PollingOptions>} object.
 *
 * @param intervalMsOrOptions - Either a number (legacy interval) or a full
 *   options object.
 * @returns Fully populated polling options with defaults filled in.
 *
 * @remarks
 * When a number is given, `fastIntervalMs` is set to it and `fullIntervalMs`
 * is set to `max(interval × 4, default)`. A value of `0` or negative returns
 * all defaults.
 */
export declare function normalizePollingOptions(intervalMsOrOptions: number | PollingOptions): Required<PollingOptions>;
/**
 * Creates an initial {@link DevicePollingState} from resolved options.
 *
 * @param options - Fully populated polling options.
 * @returns A new polling state with `nextFastPollAt` and `nextFullPollAt` set
 *   to `0` (i.e. immediately eligible).
 */
export declare function createDevicePollingState(options: Required<PollingOptions>): DevicePollingState;
/**
 * Resets both `nextFastPollAt` and `nextFullPollAt` to now + interval.
 *
 * @param state - Mutable polling state to update.
 *
 * @remarks
 * Used after a reconnect so polling does not immediately re-fire.
 */
export declare function scheduleNextPoll(state: DevicePollingState): void;
/**
 * Creates an all-zero {@link DeviceTelemetry} instance.
 *
 * @returns A new telemetry object with all counters at 0 and timestamps at
 *   `null`.
 */
export declare function createDeviceTelemetry(): DeviceTelemetry;
/**
 * Extracts a display string from an Error, preferring the message.
 *
 * @param error - Error to format.
 * @returns `error.message` if non-empty, otherwise `error.name`.
 */
export declare function formatError(error: Error): string;
/**
 * Produces a JSON-safe summary of telemetry counters for logging.
 *
 * @param telemetry - Accumulated telemetry counters.
 * @returns A plain object with counts, averages, max durations, and ISO
 *   timestamps suitable for structured logging.
 */
export declare function summarizeTelemetry(telemetry: DeviceTelemetry): Record<string, unknown>;
/**
 * Increases polling intervals and command delay after a busy response.
 *
 * @param state - Mutable polling state to back off.
 * @param options - Provides penalty amounts and maximum clamps.
 *
 * @remarks
 * `fastIntervalMs` increases by `busyPenaltyMs`, `fullIntervalMs` by twice
 * that, and `commandDelayMs` by `recoveryStepMs`. Each is clamped to its
 * respective maximum.
 */
export declare function applyBusyBackoff(state: DevicePollingState, options: Required<PollingOptions>): void;
/**
 * Decreases polling intervals and command delay toward defaults after success.
 *
 * @param state - Mutable polling state to recover.
 * @param options - Provides recovery step amounts and minimum floors.
 *
 * @remarks
 * Each interval is reduced by its recovery step but never below the default.
 * `fullIntervalMs` recovers twice as fast as `fastIntervalMs`.
 */
export declare function recoverPollingState(state: DevicePollingState, options: Required<PollingOptions>): void;
