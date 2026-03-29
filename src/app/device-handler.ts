import { BadConnectionError, CommandTimeoutError, ModbusError, ParseError } from "../bluetooth/errors.js";
import { MultiDeviceManager } from "../bluetooth/manager.js";
import { DeviceCommand, ReadHoldingRegisters } from "../core/commands.js";
import { EventBus, type CommandMessage } from "../core/event-bus.js";
import { createDeviceFromAdvertisement } from "../devices/registry.js";
import type { BluettiDevice } from "../devices/device.js";

export class DeviceHandler {
  private readonly devices = new Map<string, BluettiDevice>();
  private commandListenerAttached = false;

  constructor(
    private readonly manager: MultiDeviceManager,
    private readonly bus: EventBus<BluettiDevice, BluettiDevice, DeviceCommand>,
    private readonly intervalMs = 0,
    private readonly runOnce = false,
  ) {}

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

    for (const command of device.pollingCommands) {
      await this.executeReadCommand(device, command);
    }
  }

  async run(): Promise<void> {
    await this.connectAll();

    await Promise.all(this.manager.addresses.map(async (address) => {
      const device = this.devices.get(address);
      if (device === undefined) {
        return;
      }

      while (true) {
        await this.pollOnce(address);

        if (device.packPollingCommands.length > 0) {
          for (let pack = 1; pack <= device.packNumMax; pack += 1) {
            if (device.packNumMax > 1 && device.hasFieldSetter("pack_num")) {
              const setter = device.buildSetterCommand("pack_num", pack);
              await this.manager.getSession(address).perform(setter);
              await sleep(500);
            }

            for (const command of device.packPollingCommands) {
              await this.executeReadCommand(device, command);
            }
          }
        }

        if (this.runOnce) {
          break;
        }

        if (this.intervalMs > 0) {
          await sleep(this.intervalMs);
        }
      }
    }));
  }

  private async handleCommand(message: CommandMessage<BluettiDevice, DeviceCommand>): Promise<void> {
    const session = this.manager.getSession(message.device.address);
    await session.perform(message.command);
  }

  private async executeReadCommand(device: BluettiDevice, command: ReadHoldingRegisters): Promise<void> {
    try {
      const session = this.manager.getSession(device.address);
      const response = await session.perform(command);
      const parsed = device.parse(command.startingAddress, command.parseResponse(response));
      if (Object.keys(parsed).length > 0) {
        await this.bus.publishParserMessage({ device, parsed });
      }
    } catch (error) {
      if (
        error instanceof CommandTimeoutError
        || error instanceof ModbusError
        || error instanceof ParseError
        || error instanceof BadConnectionError
      ) {
        return;
      }
      throw error;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
