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

export interface PollingOptions {
  readonly fastIntervalMs?: number;
  readonly fullIntervalMs?: number;
  readonly commandDelayMs?: number;
  readonly busyPenaltyMs?: number;
  readonly recoveryStepMs?: number;
  readonly maxFastIntervalMs?: number;
  readonly maxFullIntervalMs?: number;
  readonly maxCommandDelayMs?: number;
}

interface DevicePollingState {
  nextFastPollAt: number;
  nextFullPollAt: number;
  fastIntervalMs: number;
  fullIntervalMs: number;
  commandDelayMs: number;
}

interface DeviceTelemetry {
  cycleCount: number;
  fastCycleCount: number;
  fullCycleCount: number;
  successfulCommandCount: number;
  expectedErrorCount: number;
  busyErrorCount: number;
  commandWriteCount: number;
  parserPublishCount: number;
  totalCycleDurationMs: number;
  totalCommandDurationMs: number;
  maxCycleDurationMs: number;
  maxCommandDurationMs: number;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastBusyAt: string | null;
  lastErrorAt: string | null;
  lastSummaryAtMs: number;
}

type CommandResult = "ok" | "expected_error" | "busy";

const DEFAULT_POLLING_OPTIONS: Required<PollingOptions> = {
  fastIntervalMs: 2_500,
  fullIntervalMs: 15_000,
  commandDelayMs: 150,
  busyPenaltyMs: 750,
  recoveryStepMs: 50,
  maxFastIntervalMs: 8_000,
  maxFullIntervalMs: 45_000,
  maxCommandDelayMs: 750,
};

const TELEMETRY_SUMMARY_INTERVAL_MS = 60_000;

export class DeviceHandler {
  private readonly devices = new Map<string, BluettiDevice>();
  private readonly pollingState = new Map<string, DevicePollingState>();
  private readonly telemetry = new Map<string, DeviceTelemetry>();
  private readonly deviceQueues = new Map<string, Promise<void>>();
  private commandListenerAttached = false;
  private stopRequested = false;
  private readonly sleepWaiters = new Set<() => void>();

  constructor(
    private readonly manager: MultiDeviceManager,
    private readonly bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>,
    intervalMsOrOptions: number | PollingOptions = 0,
    private readonly runOnce = false,
    private readonly logger: Logger = new ConsoleLogger("info"),
  ) {
    const options = normalizePollingOptions(intervalMsOrOptions);
    this.defaultPollingOptions = options;
  }

  private readonly defaultPollingOptions: Required<PollingOptions>;

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

  getDevices(): readonly BluettiDevice[] {
    return [...this.devices.values()];
  }

  async pollOnce(address: string): Promise<void> {
    const device = this.devices.get(address);
    if (device === undefined) {
      throw new Error(`Unknown device ${address}`);
    }

    const state = this.getPollingState(address);
    await this.runCommandSet(address, device, device.pollingCommands, state);
  }

  async run(): Promise<void> {
    this.stopRequested = false;
    await this.connectAll();

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

        if (shouldRunFull && result !== "busy") {
          const packResult = await this.runPackCommands(address, device, state);
          if (packResult === "busy") {
            applyBusyBackoff(state, this.defaultPollingOptions);
            telemetry.busyErrorCount += 1;
            telemetry.lastBusyAt = new Date().toISOString();
            this.logger.warn("Device reported busy during pack polling; backing off", {
              address,
              fastIntervalMs: state.fastIntervalMs,
              fullIntervalMs: state.fullIntervalMs,
              commandDelayMs: state.commandDelayMs,
              telemetry: summarizeTelemetry(telemetry),
            });
          } else {
            recoverPollingState(state, this.defaultPollingOptions);
          }
        } else if (result === "busy") {
          applyBusyBackoff(state, this.defaultPollingOptions);
          telemetry.busyErrorCount += 1;
          telemetry.lastBusyAt = new Date().toISOString();
          this.logger.warn("Device reported busy during polling; backing off", {
            address,
            fastIntervalMs: state.fastIntervalMs,
            fullIntervalMs: state.fullIntervalMs,
            commandDelayMs: state.commandDelayMs,
            telemetry: summarizeTelemetry(telemetry),
          });
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

  stop(): void {
    this.stopRequested = true;
    for (const wake of this.sleepWaiters) {
      wake();
    }
    this.sleepWaiters.clear();
  }

  private async handleCommand(message: CommandMessage<BluettiDevice, DeviceCommand>): Promise<void> {
    const telemetry = this.getTelemetry(message.device.address);
    await this.enqueueDeviceWork(message.device.address, async () => {
      const session = this.manager.getSession(message.device.address);
      telemetry.commandWriteCount += 1;
      await session.perform(message.command);
    });
  }

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
      if (result === "busy") {
        return "busy";
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
      if (
        error instanceof CommandTimeoutError
        || error instanceof ModbusError
        || error instanceof ParseError
        || error instanceof BadConnectionError
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
      if (
        error instanceof CommandTimeoutError
        || error instanceof ModbusError
        || error instanceof ParseError
        || error instanceof BadConnectionError
      ) {
        return "expected_error";
      }
      throw error;
    }
  }

  private getPollingState(address: string): DevicePollingState {
    const existing = this.pollingState.get(address);
    if (existing !== undefined) {
      return existing;
    }

    const created = createDevicePollingState(this.defaultPollingOptions);
    this.pollingState.set(address, created);
    return created;
  }

  private getTelemetry(address: string): DeviceTelemetry {
    const existing = this.telemetry.get(address);
    if (existing !== undefined) {
      return existing;
    }

    const created = createDeviceTelemetry();
    this.telemetry.set(address, created);
    return created;
  }

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

  private async enqueueDeviceWork<T>(address: string, work: () => Promise<T>): Promise<T> {
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

function normalizePollingOptions(intervalMsOrOptions: number | PollingOptions): Required<PollingOptions> {
  if (typeof intervalMsOrOptions === "number") {
    if (intervalMsOrOptions <= 0) {
      return DEFAULT_POLLING_OPTIONS;
    }

    return {
      ...DEFAULT_POLLING_OPTIONS,
      fastIntervalMs: intervalMsOrOptions,
      fullIntervalMs: Math.max(intervalMsOrOptions * 4, DEFAULT_POLLING_OPTIONS.fullIntervalMs),
    };
  }

  return {
    ...DEFAULT_POLLING_OPTIONS,
    ...intervalMsOrOptions,
  };
}

function createDevicePollingState(options: Required<PollingOptions>): DevicePollingState {
  return {
    nextFastPollAt: 0,
    nextFullPollAt: 0,
    fastIntervalMs: options.fastIntervalMs,
    fullIntervalMs: Math.max(options.fullIntervalMs, options.fastIntervalMs),
    commandDelayMs: options.commandDelayMs,
  };
}

function createDeviceTelemetry(): DeviceTelemetry {
  return {
    cycleCount: 0,
    fastCycleCount: 0,
    fullCycleCount: 0,
    successfulCommandCount: 0,
    expectedErrorCount: 0,
    busyErrorCount: 0,
    commandWriteCount: 0,
    parserPublishCount: 0,
    totalCycleDurationMs: 0,
    totalCommandDurationMs: 0,
    maxCycleDurationMs: 0,
    maxCommandDurationMs: 0,
    lastCycleStartedAt: null,
    lastCycleCompletedAt: null,
    lastBusyAt: null,
    lastErrorAt: null,
    lastSummaryAtMs: 0,
  };
}

function summarizeTelemetry(telemetry: DeviceTelemetry): Record<string, unknown> {
  const averageCycleDurationMs = telemetry.cycleCount === 0
    ? 0
    : Math.round(telemetry.totalCycleDurationMs / telemetry.cycleCount);
  const averageCommandDurationMs = telemetry.successfulCommandCount === 0
    ? 0
    : Math.round(telemetry.totalCommandDurationMs / telemetry.successfulCommandCount);

  return {
    cycleCount: telemetry.cycleCount,
    fastCycleCount: telemetry.fastCycleCount,
    fullCycleCount: telemetry.fullCycleCount,
    successfulCommandCount: telemetry.successfulCommandCount,
    expectedErrorCount: telemetry.expectedErrorCount,
    busyErrorCount: telemetry.busyErrorCount,
    commandWriteCount: telemetry.commandWriteCount,
    parserPublishCount: telemetry.parserPublishCount,
    averageCycleDurationMs,
    averageCommandDurationMs,
    maxCycleDurationMs: telemetry.maxCycleDurationMs,
    maxCommandDurationMs: telemetry.maxCommandDurationMs,
    lastCycleStartedAt: telemetry.lastCycleStartedAt,
    lastCycleCompletedAt: telemetry.lastCycleCompletedAt,
    lastBusyAt: telemetry.lastBusyAt,
    lastErrorAt: telemetry.lastErrorAt,
  };
}

function applyBusyBackoff(state: DevicePollingState, options: Required<PollingOptions>): void {
  state.fastIntervalMs = Math.min(state.fastIntervalMs + options.busyPenaltyMs, options.maxFastIntervalMs);
  state.fullIntervalMs = Math.min(state.fullIntervalMs + options.busyPenaltyMs * 2, options.maxFullIntervalMs);
  state.commandDelayMs = Math.min(state.commandDelayMs + options.recoveryStepMs, options.maxCommandDelayMs);
}

function recoverPollingState(state: DevicePollingState, options: Required<PollingOptions>): void {
  state.fastIntervalMs = Math.max(options.fastIntervalMs, state.fastIntervalMs - options.recoveryStepMs);
  state.fullIntervalMs = Math.max(options.fullIntervalMs, state.fullIntervalMs - options.recoveryStepMs * 2);
  state.commandDelayMs = Math.max(options.commandDelayMs, state.commandDelayMs - options.recoveryStepMs);
}
