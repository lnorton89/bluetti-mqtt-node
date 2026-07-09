import { MultiDeviceManager } from "@bluetooth/manager.js";
import { type DeviceCommand, ReadHoldingRegisters } from "@core/commands.js";
import { type CommandMessage, EventBus } from "@core/event-bus.js";
import type { BluettiDevice } from "@devices/device.js";
import { type CommandResult, type DevicePollingState, type DeviceTelemetry } from "./polling-state.js";
/**
 * Executes read command sets and pack selection on behalf of {@link DeviceHandler}.
 *
 * Owns the error-classification logic and per-session command dispatch so the
 * handler can focus on polling orchestration and connection management.
 */
export declare class DeviceCommandRunner {
    private readonly manager;
    private readonly bus;
    private readonly getTelemetry;
    private readonly enqueueDeviceWork;
    private readonly isStopRequested;
    private readonly sleep;
    constructor(manager: MultiDeviceManager, bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>, getTelemetry: (address: string) => DeviceTelemetry, enqueueDeviceWork: <T>(address: string, work: () => Promise<T>) => Promise<T>, isStopRequested: () => boolean, sleep: (ms: number) => Promise<void>);
    /**
     * Dispatches an external command to the target device's session.
     */
    handleCommand(message: CommandMessage<BluettiDevice, DeviceCommand>): Promise<void>;
    /**
     * Polls per-battery-pack register windows, switching the active pack first.
     */
    runPackCommands(address: string, device: BluettiDevice, pollingState: DevicePollingState): Promise<CommandResult>;
    /**
     * Executes a sequence of read commands with inter-command delays.
     */
    runCommandSet(address: string, device: BluettiDevice, commands: readonly ReadHoldingRegisters[], pollingState: DevicePollingState): Promise<CommandResult>;
    /**
     * Performs one read command, publishes parsed telemetry, and records metrics.
     */
    private executeReadCommand;
    /**
     * Writes the pack_num setter and waits for the device to settle.
     */
    private trySelectPack;
}
