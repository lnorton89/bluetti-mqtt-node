import { MultiDeviceManager } from "@bluetooth/manager.js";
import { DeviceCommand } from "@core/commands.js";
import { EventBus } from "@core/event-bus.js";
import { type Logger } from "@core/logger.js";
import type { BluettiDevice } from "@devices/device.js";
import { type PollingOptions } from "./polling-state.js";
export type { PollingOptions } from "./polling-state.js";
/**
 * Polls initialized devices and publishes decoded telemetry to the event bus.
 *
 * @remarks
 * Work is serialized per device (via a promise-chain mutex) so external writes
 * cannot overlap polling reads. Busy responses slow polling gradually using
 * adaptive backoff; successful cycles restore the configured cadence. Broken
 * Bluetooth connections are replaced in-process through
 * {@link MultiDeviceManager.reconnect}.
 *
 * Each device runs an independent polling loop. Full cycles include slow
 * configuration and battery-pack windows; fast cycles read only the leading
 * live power/state window to minimize latency.
 *
 * @example
 * ```ts
 * const handler = new DeviceHandler(manager, bus, { fastIntervalMs: 2500 });
 * await handler.connectAll();
 * await handler.run();
 * ```
 *
 * @see BluettiMqttServer
 * @see MultiDeviceManager
 */
export declare class DeviceHandler {
    private readonly manager;
    private readonly bus;
    private readonly runOnce;
    private readonly logger;
    /** Device models keyed by Bluetooth address. */
    private readonly devices;
    /** Per-device adaptive polling schedule state. */
    private readonly pollingState;
    /** Per-device telemetry counters. */
    private readonly telemetry;
    /** Delegated command execution with error classification. */
    private readonly executor;
    /** Per-address work queue with interruptible sleep and stop signalling. */
    private readonly queue;
    /** Whether the event bus command listener has been installed. */
    private commandListenerAttached;
    /** Resolved polling options with defaults filled in. */
    private readonly defaultPollingOptions;
    /**
     * Creates a polling handler for one or more devices.
     *
     * @param manager - Device session manager owning the BLE connections.
     * @param bus - Event bus for publishing telemetry and receiving commands.
     * @param intervalMsOrOptions - Either a legacy interval in milliseconds, or
     *   a full {@link PollingOptions} object. `0` uses defaults.
     * @param runOnce - When `true`, performs one poll cycle and exits.
     * @param logger - Optional logger; defaults to `ConsoleLogger` at `info`.
     */
    constructor(manager: MultiDeviceManager, bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>, intervalMsOrOptions?: number | PollingOptions, runOnce?: boolean, logger?: Logger);
    /**
     * Connects all configured devices and initializes their model-specific
     * polling state.
     *
     * @throws {BadConnectionError} When a device fails to connect (after the
     *   session's internal retries are exhausted).
     *
     * @remarks
     * Also installs the command listener on the event bus (once) so external
     * MQTT commands can be dispatched to the correct device session.
     */
    connectAll(): Promise<void>;
    /**
     * Returns all currently initialized device models.
     *
     * @returns Array of {@link BluettiDevice} instances keyed by address.
     */
    getDevices(): readonly BluettiDevice[];
    /**
     * Executes the complete polling set once for an initialized address.
     *
     * @param address - Bluetooth MAC address of an initialized device.
     * @throws {Error} When the address is unknown (not connected).
     *
     * @remarks
     * Intended for one-shot CLI usage. Does not start the continuous polling
     * loop — use {@link DeviceHandler.run} for that.
     */
    pollOnce(address: string): Promise<void>;
    /**
     * Runs independent polling loops for every configured device.
     *
     * @remarks
     * Starts all loops in parallel via `Promise.all`. Each loop alternates
     * between fast and full polling cycles based on the adaptive schedule.
     * Returns when all loops exit (due to {@link stop}, one-shot mode, or
     * unrecoverable connection loss).
     */
    run(): Promise<void>;
    /** Requests cooperative shutdown and wakes any sleeping loops. */
    stop(): void;
    /**
     * Returns the polling state for an address, creating it if absent.
     *
     * @param address - Bluetooth MAC address.
     * @returns The {@link DevicePollingState} for that address.
     */
    private getPollingState;
    /**
     * Returns the telemetry counters for an address, creating them if absent.
     *
     * @param address - Bluetooth MAC address.
     * @returns The {@link DeviceTelemetry} for that address.
     */
    private getTelemetry;
    /**
     * Emits a telemetry summary log entry at most once per
     * {@link TELEMETRY_SUMMARY_INTERVAL_MS}.
     *
     * @param address - Bluetooth MAC address.
     * @param state - Current polling schedule state.
     * @param telemetry - Accumulated telemetry counters.
     */
    private maybeLogTelemetrySummary;
    /**
     * Emits a busy-warning log entry at most once per
     * {@link BUSY_WARNING_INTERVAL_MS}, suppressing duplicates in between.
     *
     * @param address - Bluetooth MAC address.
     * @param state - Current polling schedule state.
     * @param telemetry - Accumulated telemetry counters.
     * @param phase - Which polling phase triggered the busy ("polling" or
     *   "pack polling").
     *
     * @remarks
     * Suppressed warnings are counted and included in the next emitted warning
     * so the operator can see how many were held back.
     */
    private maybeLogBusyWarning;
}
