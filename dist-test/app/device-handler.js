import { ConsoleLogger } from "@core/logger.js";
import { createDeviceFromAdvertisement } from "@devices/registry.js";
import { applyBusyBackoff, BUSY_WARNING_INTERVAL_MS, createDevicePollingState, createDeviceTelemetry, normalizePollingOptions, recoverPollingState, scheduleNextPoll, summarizeTelemetry, TELEMETRY_SUMMARY_INTERVAL_MS, } from "./polling-state.js";
import { DeviceCommandRunner } from "./device-executor.js";
import { connectAllWithRecovery, recoverDeviceConnection } from "./device-connection.js";
import { DeviceWorkQueue } from "./device-queue.js";
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
export class DeviceHandler {
    manager;
    bus;
    runOnce;
    logger;
    /** Device models keyed by Bluetooth address. */
    devices = new Map();
    /** Per-device adaptive polling schedule state. */
    pollingState = new Map();
    /** Per-device telemetry counters. */
    telemetry = new Map();
    /** Delegated command execution with error classification. */
    executor;
    /** Per-address work queue with interruptible sleep and stop signalling. */
    queue = new DeviceWorkQueue();
    /** Whether the event bus command listener has been installed. */
    commandListenerAttached = false;
    /** Resolved polling options with defaults filled in. */
    defaultPollingOptions;
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
    constructor(manager, bus, intervalMsOrOptions = 0, runOnce = false, logger = new ConsoleLogger("info")) {
        this.manager = manager;
        this.bus = bus;
        this.runOnce = runOnce;
        this.logger = logger;
        this.defaultPollingOptions = normalizePollingOptions(intervalMsOrOptions);
        this.executor = new DeviceCommandRunner(manager, bus, (addr) => this.getTelemetry(addr), (addr, work) => this.queue.enqueue(addr, work), () => this.queue.isStopRequested, (ms) => this.queue.sleep(ms));
    }
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
    async connectAll() {
        await this.manager.connectAll();
        if (!this.commandListenerAttached) {
            this.bus.addCommandListener(async (message) => {
                await this.executor.handleCommand(message);
            });
            this.commandListenerAttached = true;
        }
        for (const address of this.manager.addresses) {
            if (!this.devices.has(address)) {
                const name = this.manager.getName(address);
                this.devices.set(address, createDeviceFromAdvertisement(address, name));
            }
            if (!this.pollingState.has(address)) {
                this.pollingState.set(address, createDevicePollingState(this.defaultPollingOptions));
            }
            if (!this.telemetry.has(address)) {
                this.telemetry.set(address, createDeviceTelemetry());
            }
        }
    }
    /**
     * Returns all currently initialized device models.
     *
     * @returns Array of {@link BluettiDevice} instances keyed by address.
     */
    getDevices() {
        return [...this.devices.values()];
    }
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
    async pollOnce(address) {
        const device = this.devices.get(address);
        if (device === undefined) {
            throw new Error(`Unknown device ${address}`);
        }
        const state = this.getPollingState(address);
        await this.executor.runCommandSet(address, device, device.pollingCommands, state);
    }
    /**
     * Runs independent polling loops for every configured device.
     *
     * @remarks
     * Starts all loops in parallel via `Promise.all`. Each loop alternates
     * between fast and full polling cycles based on the adaptive schedule.
     * Returns when all loops exit (due to {@link stop}, one-shot mode, or
     * unrecoverable connection loss).
     */
    async run() {
        this.queue.reset();
        const connected = await connectAllWithRecovery(() => this.connectAll(), () => this.queue.isStopRequested, this.runOnce, this.logger, (ms) => this.queue.sleep(ms));
        if (!connected) {
            return;
        }
        await Promise.all(this.manager.addresses.map(async (address) => {
            const device = this.devices.get(address);
            if (device === undefined) {
                return;
            }
            const state = this.getPollingState(address);
            const telemetry = this.getTelemetry(address);
            while (!this.queue.isStopRequested) {
                const now = Date.now();
                const shouldRunFull = now >= state.nextFullPollAt;
                const shouldRunFast = shouldRunFull || now >= state.nextFastPollAt;
                if (!shouldRunFast) {
                    await this.queue.sleep(Math.max(0, Math.min(state.nextFastPollAt, state.nextFullPollAt) - now));
                    continue;
                }
                // Full cycles include slow configuration and battery-pack windows.
                // Fast cycles read only the leading live power/state window.
                const commands = shouldRunFull
                    ? [...device.fastPollingCommands, ...device.slowPollingCommands]
                    : [...device.fastPollingCommands];
                const cycleStartedAt = Date.now();
                telemetry.cycleCount += 1;
                telemetry.lastCycleStartedAt = new Date(cycleStartedAt).toISOString();
                if (shouldRunFull) {
                    telemetry.fullCycleCount += 1;
                }
                else {
                    telemetry.fastCycleCount += 1;
                }
                const result = await this.executor.runCommandSet(address, device, commands, state);
                if (result === "connection_error") {
                    if (this.runOnce) {
                        break;
                    }
                    const recovered = await recoverDeviceConnection(address, this.manager, () => this.queue.isStopRequested, this.logger, (ms) => this.queue.sleep(ms));
                    if (!recovered) {
                        break;
                    }
                    scheduleNextPoll(state);
                    continue;
                }
                if (shouldRunFull && result !== "busy") {
                    const packResult = await this.executor.runPackCommands(address, device, state);
                    if (packResult === "connection_error") {
                        if (this.runOnce) {
                            break;
                        }
                        const recovered = await recoverDeviceConnection(address, this.manager, () => this.queue.isStopRequested, this.logger, (ms) => this.queue.sleep(ms));
                        if (!recovered) {
                            break;
                        }
                        scheduleNextPoll(state);
                        continue;
                    }
                    if (packResult === "busy") {
                        applyBusyBackoff(state, this.defaultPollingOptions);
                        telemetry.busyErrorCount += 1;
                        telemetry.lastBusyAt = new Date().toISOString();
                        this.maybeLogBusyWarning(address, state, telemetry, "pack polling");
                    }
                    else {
                        recoverPollingState(state, this.defaultPollingOptions);
                    }
                }
                else if (result === "busy") {
                    applyBusyBackoff(state, this.defaultPollingOptions);
                    telemetry.busyErrorCount += 1;
                    telemetry.lastBusyAt = new Date().toISOString();
                    this.maybeLogBusyWarning(address, state, telemetry, "polling");
                }
                else {
                    recoverPollingState(state, this.defaultPollingOptions);
                }
                const cycleCompletedAt = Date.now();
                const cycleDurationMs = cycleCompletedAt - cycleStartedAt;
                telemetry.totalCycleDurationMs += cycleDurationMs;
                telemetry.maxCycleDurationMs = Math.max(telemetry.maxCycleDurationMs, cycleDurationMs);
                telemetry.lastCycleCompletedAt = new Date(cycleCompletedAt).toISOString();
                this.logger.debug("Polling cycle completed", {
                    address,
                    cycleType: shouldRunFull ? "full" : "fast",
                    result,
                    commandCount: commands.length,
                    cycleDurationMs,
                    nextFastPollInMs: state.fastIntervalMs,
                    nextFullPollInMs: shouldRunFull ? state.fullIntervalMs : Math.max(0, state.nextFullPollAt - cycleCompletedAt),
                    commandDelayMs: state.commandDelayMs,
                    telemetry: summarizeTelemetry(telemetry),
                });
                this.maybeLogTelemetrySummary(address, state, telemetry);
                const nextAt = Date.now();
                state.nextFastPollAt = nextAt + state.fastIntervalMs;
                if (shouldRunFull) {
                    state.nextFullPollAt = nextAt + state.fullIntervalMs;
                }
                if (this.runOnce || this.queue.isStopRequested) {
                    break;
                }
            }
        }));
    }
    /** Requests cooperative shutdown and wakes any sleeping loops. */
    stop() {
        this.queue.stop();
    }
    /**
     * Returns the polling state for an address, creating it if absent.
     *
     * @param address - Bluetooth MAC address.
     * @returns The {@link DevicePollingState} for that address.
     */
    getPollingState(address) {
        const existing = this.pollingState.get(address);
        if (existing !== undefined) {
            return existing;
        }
        const created = createDevicePollingState(this.defaultPollingOptions);
        this.pollingState.set(address, created);
        return created;
    }
    /**
     * Returns the telemetry counters for an address, creating them if absent.
     *
     * @param address - Bluetooth MAC address.
     * @returns The {@link DeviceTelemetry} for that address.
     */
    getTelemetry(address) {
        const existing = this.telemetry.get(address);
        if (existing !== undefined) {
            return existing;
        }
        const created = createDeviceTelemetry();
        this.telemetry.set(address, created);
        return created;
    }
    /**
     * Emits a telemetry summary log entry at most once per
     * {@link TELEMETRY_SUMMARY_INTERVAL_MS}.
     *
     * @param address - Bluetooth MAC address.
     * @param state - Current polling schedule state.
     * @param telemetry - Accumulated telemetry counters.
     */
    maybeLogTelemetrySummary(address, state, telemetry) {
        const now = Date.now();
        if (now - telemetry.lastSummaryAtMs < TELEMETRY_SUMMARY_INTERVAL_MS) {
            return;
        }
        telemetry.lastSummaryAtMs = now;
        this.logger.info("Polling telemetry summary", {
            address,
            fastIntervalMs: state.fastIntervalMs,
            fullIntervalMs: state.fullIntervalMs,
            commandDelayMs: state.commandDelayMs,
            telemetry: summarizeTelemetry(telemetry),
        });
    }
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
    maybeLogBusyWarning(address, state, telemetry, phase) {
        const now = Date.now();
        if (now - telemetry.lastBusyWarningAtMs < BUSY_WARNING_INTERVAL_MS) {
            telemetry.suppressedBusyWarningCount += 1;
            return;
        }
        const suppressedCount = telemetry.suppressedBusyWarningCount;
        telemetry.lastBusyWarningAtMs = now;
        telemetry.suppressedBusyWarningCount = 0;
        this.logger.warn(`Device reported busy during ${phase}; backing off`, {
            address,
            fastIntervalMs: state.fastIntervalMs,
            fullIntervalMs: state.fullIntervalMs,
            commandDelayMs: state.commandDelayMs,
            suppressedBusyWarnings: suppressedCount,
            telemetry: summarizeTelemetry(telemetry),
        });
    }
}
