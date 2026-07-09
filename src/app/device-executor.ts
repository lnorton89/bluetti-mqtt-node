import {
	BadConnectionError,
	CommandTimeoutError,
	DeviceBusyError,
	ModbusError,
	ParseError,
} from "@bluetooth/errors.js";
import type { MultiDeviceManager } from "@bluetooth/manager.js";
import type { DeviceCommand, ReadHoldingRegisters } from "@core/commands.js";
import type { CommandMessage, EventBus } from "@core/event-bus.js";
import type { BluettiDevice } from "@devices/device.js";
import { MIN_PACK_SWITCH_DELAY_MS } from "./constants.js";
import type {
	CommandResult,
	DevicePollingState,
	DeviceTelemetry,
} from "./polling-state.js";

/**
 * Executes read command sets and pack selection on behalf of {@link DeviceHandler}.
 *
 * Owns the error-classification logic and per-session command dispatch so the
 * handler can focus on polling orchestration and connection management.
 */
export class DeviceCommandRunner {
	constructor(
		private readonly manager: MultiDeviceManager,
		private readonly bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>,
		private readonly getTelemetry: (address: string) => DeviceTelemetry,
		private readonly enqueueDeviceWork: <T>(
			address: string,
			work: () => Promise<T>,
		) => Promise<T>,
		private readonly isStopRequested: () => boolean,
		private readonly sleep: (ms: number) => Promise<void>,
	) {}

	/**
	 * Dispatches an external command to the target device's session.
	 */
	async handleCommand(
		message: CommandMessage<BluettiDevice, DeviceCommand>,
	): Promise<void> {
		const telemetry = this.getTelemetry(message.device.address);
		await this.enqueueDeviceWork(message.device.address, async () => {
			const session = this.manager.getSession(message.device.address);
			telemetry.commandWriteCount += 1;
			await session.perform(message.command);
		});
	}

	/**
	 * Polls per-battery-pack register windows, switching the active pack first.
	 */
	async runPackCommands(
		address: string,
		device: BluettiDevice,
		pollingState: DevicePollingState,
	): Promise<CommandResult> {
		if (device.packPollingCommands.length === 0) {
			return "ok";
		}

		for (let pack = 1; pack <= device.packNumMax; pack += 1) {
			if (this.isStopRequested()) {
				break;
			}

			if (device.packNumMax > 1 && device.hasFieldSetter("pack_num")) {
				const switched = await this.trySelectPack(
					address,
					device,
					pack,
					pollingState,
				);
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

			const result = await this.runCommandSet(
				address,
				device,
				device.packPollingCommands,
				pollingState,
			);
			if (result === "busy") {
				return "busy";
			}
		}

		return "ok";
	}

	/**
	 * Executes a sequence of read commands with inter-command delays.
	 */
	async runCommandSet(
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
			if (this.isStopRequested()) {
				break;
			}

			const result = await this.executeReadCommand(
				address,
				device,
				commands[index]!,
			);
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
				const parsed = device.parse(
					command.startingAddress,
					command.parseResponse(response),
				);
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
				error instanceof CommandTimeoutError ||
				error instanceof ModbusError ||
				error instanceof ParseError
			) {
				telemetry.expectedErrorCount += 1;
				telemetry.lastErrorAt = new Date().toISOString();
				return "expected_error";
			}
			throw error;
		} finally {
			const commandDurationMs = Date.now() - startedAt;
			telemetry.totalCommandDurationMs += commandDurationMs;
			telemetry.maxCommandDurationMs = Math.max(
				telemetry.maxCommandDurationMs,
				commandDurationMs,
			);
		}
	}

	/**
	 * Writes the pack_num setter and waits for the device to settle.
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

			await this.sleep(
				Math.max(MIN_PACK_SWITCH_DELAY_MS, pollingState.commandDelayMs),
			);
			return "ok";
		} catch (error) {
			if (error instanceof DeviceBusyError) {
				return "busy";
			}
			if (error instanceof BadConnectionError) {
				return "connection_error";
			}
			if (
				error instanceof CommandTimeoutError ||
				error instanceof ModbusError ||
				error instanceof ParseError
			) {
				return "expected_error";
			}
			throw error;
		}
	}
}
