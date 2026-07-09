import {
  BadConnectionError,
  CommandTimeoutError,
  DeviceBusyError,
  ModbusError,
  ParseError,
} from "../bluetooth/errors.js";
import { MultiDeviceManager } from "../bluetooth/manager.js";
import { DeviceCommand, ReadHoldingRegisters } from "../core/commands.js";
import { EventBus, type CommandMessage } from "../core/event-bus.js";
import { ConsoleLogger, type Logger } from "../core/logger.js";
import { createDeviceFromAdvertisement } from "../devices/registry.js";
import type { BluettiDevice } from "../devices/device.js";
import {
  applyBusyBackoff,
  BUSY_WARNING_INTERVAL_MS,
  type CommandResult,
  createDevicePollingState,
  createDeviceTelemetry,
  type DevicePollingState,
  type DeviceTelemetry,
  formatError,
  normalizePollingOptions,
  type PollingOptions,
  recoverPollingState,
  scheduleNextPoll,
  STARTUP_RETRY_DELAY_MS,
  summarizeTelemetry,
  TELEMETRY_SUMMARY_INTERVAL_MS,
} from "./polling-state.js";

// Re-export so existing imports from device-handler.js continue to work.
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
export class DeviceHandler {
  /** Device models keyed by Bluetooth address. */
  private readonly devices = new Map<string, BluettiDevice>();
  /** Per-device adaptive polling schedule state. */
  private readonly pollingState = new Map<string, DevicePollingState>();
  /** Per-device telemetry counters. */
  private readonly telemetry = new Map<string, DeviceTelemetry>();
  /** Per-device promise-chain mutex queues for serialized work. */
  private readonly deviceQueues = new Map<string, Promise<void>>();
  /** Whether the event bus command listener has been installed. */
  private commandListenerAttached = false;
  /** Whether {@link stop} has been requested. */
  private stopRequested = false;
  /** Registered wake callbacks for interrupting {@link sleep}. */
  private readonly sleepWaiters = new Set<() => void>();

  /** Resolved polling options with defaults filled in. */
  private readonly defaultPollingOptions: Required<PollingOptions>;

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
  constructor(
    private readonly manager: MultiDeviceManager,
    private readonly bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>,
    intervalMsOrOptions: number | PollingOptions = 0,
    private readonly runOnce = false,
    private readonly logger: Logger = new ConsoleLogger("info"),
  ) {
    this.defaultPollingOptions = normalizePollingOptions(intervalMsOrOptions);
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
  async connectAll(): Promise<void> {
    await this.manager.connectAll();
    if (!this.commandListenerAttached) {
      this.bus.addCommandListener(async (message) => {
        await this.handleCommand(message);
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
  getDevices(): readonly BluettiDevice[] {
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
  async pollOnce(address: string): Promise<void> {
    const device = this.devices.get(address);
    if (device === undefined) {
      throw new Error(`Unknown device ${address}`);
    }

    const state = this.getPollingState(address);
    await this.runCommandSet(address, device, device.pollingCommands, state);
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
  async run(): Promise<void> {
    this.stopRequested = false;
    const connected = await this.connectAllWithRecovery();
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

      while (!this.stopRequested) {
        const now = Date.now();
        const shouldRunFull = now >= state.nextFullPollAt;
        const shouldRunFast = shouldRunFull || now >= state.nextFastPollAt;

        if (!shouldRunFast) {
          await this.sleep(Math.max(0, Math.min(state.nextFastPollAt, state.nextFullPollAt) - now));
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
        } else {
          telemetry.fastCycleCount += 1;
        }

        const result = await this.runCommandSet(address, device, commands, state);

        if (result === "connection_error") {
          if (this.runOnce) {
            break;
          }
          const recovered = await this.recoverDeviceConnection(address);
          if (!recovered) {
            break;
          }
          scheduleNextPoll(state);
          continue;
        }

        if (shouldRunFull && result !== "busy") {
          const packResult = await this.runPackCommands(address, device, state);
          if (packResult === "connection_error") {
            if (this.runOnce) {
              break;
            }
            const recovered = await this.recoverDeviceConnection(address);
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
          } else {
            recoverPollingState(state, this.defaultPollingOptions);
          }
        } else if (result === "busy") {
          applyBusyBackoff(state, this.defaultPollingOptions);
          telemetry.busyErrorCount += 1;
          telemetry.lastBusyAt = new Date().toISOString();
          this.maybeLogBusyWarning(address, state, telemetry, "polling");
        } else {
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

        if (this.runOnce || this.stopRequested) {
          break;
        }
      }
    }));
  }

  /**
   * Calls {@link connectAll} with retry-on-failure for recoverable BLE startup
   * errors.
   *
   * @returns `true` when connection succeeds, `false` when stopped before
   *   success.
   * @throws {Error} When a non-recoverable error occurs or `runOnce` is set.
   *
   * @remarks
   * Retries {@link BadConnectionError} indefinitely with a fixed delay until
   * either the connection succeeds or {@link stop} is requested. Non-BLE
   * errors propagate immediately.
   */
  private async connectAllWithRecovery(): Promise<boolean> {
    while (!this.stopRequested) {
      try {
        await this.connectAll();
        return true;
      } catch (error) {
        if (this.runOnce || !(error instanceof BadConnectionError)) {
          throw error;
        }

        this.logger.warn("Bluetooth startup failed; retrying", {
          error: formatError(error instanceof Error ? error : new Error(String(error))),
          retryInMs: STARTUP_RETRY_DELAY_MS,
        });
        await this.sleep(STARTUP_RETRY_DELAY_MS);
      }
    }

    return false;
  }

  /**
   * Repeatedly attempts to reconnect a lost device until success or stop.
   *
   * @param address - Bluetooth MAC address of the device to recover.
   * @returns `true` when reconnection succeeds, `false` when stopped.
   *
   * @remarks
   * Logs each failure and waits {@link STARTUP_RETRY_DELAY_MS} before retrying.
   * A replacement session is published by the manager only after initialization
   * and notification subscription both succeed.
   */
  private async recoverDeviceConnection(address: string): Promise<boolean> {
    this.logger.warn("Bluetooth connection lost; reconnecting", { address });

    while (!this.stopRequested) {
      // A replacement is published by the manager only after initialization
      // and notification subscription both succeed.
      try {
        await this.manager.reconnect(address);
        this.logger.info("Bluetooth connection recovered", { address });
        return true;
      } catch (error) {
        this.logger.warn("Bluetooth reconnect failed; retrying", {
          address,
          error: formatError(error instanceof Error ? error : new Error(String(error))),
          retryInMs: STARTUP_RETRY_DELAY_MS,
        });
        await this.sleep(STARTUP_RETRY_DELAY_MS);
      }
    }

    return false;
  }

  /**
   * Requests cooperative shutdown and wakes any loops currently sleeping.
   *
   * @remarks
   * Sets the stop flag and resolves all pending sleep promises so that
   * polling loops exit at their next iteration check.
   */
  stop(): void {
    this.stopRequested = true;
    for (const wake of this.sleepWaiters) {
      wake();
    }
    this.sleepWaiters.clear();
  }

  /**
   * Dispatches an external command to the target device's session.
   *
   * @param message - Command message from the event bus.
   *
   * @remarks
   * Work is enqueued through {@link enqueueDeviceWork} so it does not overlap
   * with an in-progress polling cycle for the same device.
   */
  private async handleCommand(message: CommandMessage<BluettiDevice, DeviceCommand>): Promise<void> {
    const telemetry = this.getTelemetry(message.device.address);
    await this.enqueueDeviceWork(message.device.address, async () => {
      const session = this.manager.getSession(message.device.address);
      telemetry.commandWriteCount += 1;
      await session.perform(message.command);
    });
  }

  /**
   * Polls per-battery-pack register windows, switching the active pack first.
   *
   * @param address - Bluetooth MAC address of the device.
   * @param device - Device model with pack polling commands.
   * @param pollingState - Mutable polling schedule state.
   * @returns {@link CommandResult} indicating the outcome of the pack scan.
   *
   * @remarks
   * For devices with multiple packs and a writable `pack_num` field, this
   * method iterates packs 1 through `packNumMax`, writes the pack selector,
   * waits for the device to settle, then runs the pack polling command set.
   * If a pack switch fails with an expected error, that pack is skipped.
   */
  private async runPackCommands(
    address: string,
    device: BluettiDevice,
    pollingState: DevicePollingState,
  ): Promise<CommandResult> {
    if (device.packPollingCommands.length === 0) {
      return "ok";
    }

    for (let pack = 1; pack <= device.packNumMax; pack += 1) {
      if (this.stopRequested) {
        break;
      }

      if (device.packNumMax > 1 && device.hasFieldSetter("pack_num")) {
        const switched = await this.trySelectPack(address, device, pack, pollingState);
        if (switched === "busy") {
          return "busy";
        }
        if (switched === "connection_error") {
          return "connection_error";
        }
        if (switched === "expected_error") {
          continue;
        }
      }

      const result = await this.runCommandSet(address, device, device.packPollingCommands, pollingState);
      if (result === "busy") {
        return "busy";
      }
    }

    return "ok";
  }

  /**
   * Executes a sequence of read commands with inter-command delays.
   *
   * @param address - Bluetooth MAC address of the device.
   * @param device - Device model for field decoding.
   * @param commands - Ordered list of read commands to execute.
   * @param pollingState - Mutable polling schedule state (used for delay).
   * @returns `"ok"` if all succeeded, `"expected_error"` if a recoverable
   *   error occurred, or `"busy"`/`"connection_error"` to abort the set.
   *
   * @remarks
   * Stops early on `busy` or `connection_error`. Accumulates `expected_error`
   * results so the caller knows the set was partially degraded.
   */
  private async runCommandSet(
    address: string,
    device: BluettiDevice,
    commands: readonly ReadHoldingRegisters[],
    pollingState: DevicePollingState,
  ): Promise<CommandResult> {
    if (commands.length === 0) {
      return "ok";
    }

    let sawExpectedError = false;

    for (let index = 0; index < commands.length; index += 1) {
      if (this.stopRequested) {
        break;
      }

      const result = await this.executeReadCommand(address, device, commands[index]!);
      if (result === "busy" || result === "connection_error") {
        return result;
      }
      if (result === "expected_error") {
        sawExpectedError = true;
      }

      const hasMoreCommands = index < commands.length - 1;
      if (hasMoreCommands && pollingState.commandDelayMs > 0) {
        await this.sleep(pollingState.commandDelayMs);
      }
    }

    return sawExpectedError ? "expected_error" : "ok";
  }

  /**
   * Performs one read command, publishes parsed telemetry, and records metrics.
   *
   * @param address - Bluetooth MAC address of the device.
   * @param device - Device model for field decoding.
   * @param command - Read command to execute.
   * @returns {@link CommandResult} classifying the outcome.
   * @throws {Error} For unexpected errors that are not MODBUS/parse/timeout/busy/
   *   connection errors.
   *
   * @remarks
   * On success, parsed fields are published to the event bus via
   * {@link EventBus.publishParserMessage}. Command duration is always recorded
   * in the `finally` block, even when an error is thrown.
   */
  private async executeReadCommand(
    address: string,
    device: BluettiDevice,
    command: ReadHoldingRegisters,
  ): Promise<CommandResult> {
    const telemetry = this.getTelemetry(address);
    const startedAt = Date.now();

    try {
      await this.enqueueDeviceWork(address, async () => {
        const session = this.manager.getSession(address);
        const response = await session.perform(command);
        const parsed = device.parse(command.startingAddress, command.parseResponse(response));
        if (Object.keys(parsed).length > 0) {
          telemetry.parserPublishCount += 1;
          await this.bus.publishParserMessage({ device, parsed });
        }
      });
      telemetry.successfulCommandCount += 1;
      return "ok";
    } catch (error) {
      if (error instanceof DeviceBusyError) {
        telemetry.lastBusyAt = new Date().toISOString();
        return "busy";
      }
      if (error instanceof BadConnectionError) {
        telemetry.expectedErrorCount += 1;
        telemetry.lastErrorAt = new Date().toISOString();
        return "connection_error";
      }
      if (
        error instanceof CommandTimeoutError
        || error instanceof ModbusError
        || error instanceof ParseError
      ) {
        telemetry.expectedErrorCount += 1;
        telemetry.lastErrorAt = new Date().toISOString();
        return "expected_error";
      }
      throw error;
    } finally {
      const commandDurationMs = Date.now() - startedAt;
      telemetry.totalCommandDurationMs += commandDurationMs;
      telemetry.maxCommandDurationMs = Math.max(telemetry.maxCommandDurationMs, commandDurationMs);
    }
  }

  /**
   * Writes the `pack_num` setter and waits for the device to settle.
   *
   * @param address - Bluetooth MAC address of the device.
   * @param device - Device model with a writable `pack_num` field.
   * @param pack - Pack number to select (1-based).
   * @param pollingState - Mutable polling schedule state (used for delay).
   * @returns {@link CommandResult} classifying the outcome.
   * @throws {Error} For unexpected errors.
   *
   * @remarks
   * After writing the setter, waits at least 500 ms (or the current command
   * delay, whichever is larger) for the device to switch its active pack data.
   */
  private async trySelectPack(
    address: string,
    device: BluettiDevice,
    pack: number,
    pollingState: DevicePollingState,
  ): Promise<CommandResult> {
    try {
      await this.enqueueDeviceWork(address, async () => {
        const setter = device.buildSetterCommand("pack_num", pack);
        await this.manager.getSession(address).perform(setter);
      });

      await this.sleep(Math.max(500, pollingState.commandDelayMs));
      return "ok";
    } catch (error) {
      if (error instanceof DeviceBusyError) {
        return "busy";
      }
      if (error instanceof BadConnectionError) {
        return "connection_error";
      }
      if (
        error instanceof CommandTimeoutError
        || error instanceof ModbusError
        || error instanceof ParseError
      ) {
        return "expected_error";
      }
      throw error;
    }
  }

  /**
   * Returns the polling state for an address, creating it if absent.
   *
   * @param address - Bluetooth MAC address.
   * @returns The {@link DevicePollingState} for that address.
   */
  private getPollingState(address: string): DevicePollingState {
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
  private getTelemetry(address: string): DeviceTelemetry {
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
  private maybeLogTelemetrySummary(
    address: string,
    state: DevicePollingState,
    telemetry: DeviceTelemetry,
  ): void {
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
  private maybeLogBusyWarning(
    address: string,
    state: DevicePollingState,
    telemetry: DeviceTelemetry,
    phase: "polling" | "pack polling",
  ): void {
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

  /**
   * Serializes async work per address using a promise-chain mutex.
   *
   * @param address - Bluetooth MAC address whose work queue to use.
   * @param work - Async function to execute once it is this address's turn.
   * @returns The result of `work`.
   *
   * @remarks
   * Promise chaining acts as a per-address mutex without delaying unrelated
   * devices that have their own queues. The queue entry is cleaned up after
   * the work completes so stale promises do not accumulate.
   */
  private async enqueueDeviceWork<T>(address: string, work: () => Promise<T>): Promise<T> {
    // Promise chaining acts as a per-address mutex without delaying unrelated
    // devices that have their own queues.
    const previous = this.deviceQueues.get(address) ?? Promise.resolve();
    let release!: () => void;

    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.deviceQueues.set(address, queued);

    await previous;

    try {
      return await work();
    } finally {
      release();
      if (this.deviceQueues.get(address) === queued) {
        this.deviceQueues.delete(address);
      }
    }
  }

  /**
   * Sleeps for `ms` milliseconds, interruptible by {@link stop}.
   *
   * @param ms - Duration in milliseconds. Returns immediately if `<= 0` or
   *   stop has been requested.
   *
   * @remarks
   * Registers the waiter in {@link sleepWaiters} so that {@link stop} can
   * wake all sleeping loops immediately without waiting for their timers.
   * The waiter is idempotent and cleans up after itself.
   */
  private async sleep(ms: number): Promise<void> {
    if (this.stopRequested || ms <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const done = (): void => {
        if (finished) {
          return;
        }

        finished = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        this.sleepWaiters.delete(done);
        resolve();
      };

      this.sleepWaiters.add(done);
      timer = setTimeout(done, ms);
    });
  }
}
