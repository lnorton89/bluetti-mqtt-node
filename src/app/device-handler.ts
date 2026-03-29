import { BadConnectionError, CommandTimeoutError, ModbusError, ParseError } from "../bluetooth/errors.js";
import { MultiDeviceManager } from "../bluetooth/manager.js";
import { DeviceCommand, ReadHoldingRegisters } from "../core/commands.js";
import { EventBus, type CommandMessage } from "../core/event-bus.js";
import { createDeviceFromAdvertisement } from "../devices/registry.js";
import type { BluettiDevice } from "../devices/device.js";

export class DeviceHandler {
  private readonly devices = new Map<string, BluettiDevice>();
  private commandListenerAttached = false;
  private stopRequested = false;
  private readonly sleepWaiters = new Set<() => void>();

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
    this.stopRequested = false;
    await this.connectAll();

    await Promise.all(this.manager.addresses.map(async (address) => {
      const device = this.devices.get(address);
      if (device === undefined) {
        return;
      }

      while (!this.stopRequested) {
        await this.pollOnce(address);

        if (this.stopRequested) {
          break;
        }

        if (device.packPollingCommands.length > 0) {
          for (let pack = 1; pack <= device.packNumMax; pack += 1) {
            if (this.stopRequested) {
              break;
            }

            if (device.packNumMax > 1 && device.hasFieldSetter("pack_num")) {
              const setter = device.buildSetterCommand("pack_num", pack);
              await this.manager.getSession(address).perform(setter);
              await this.sleep(500);
            }

            for (const command of device.packPollingCommands) {
              if (this.stopRequested) {
                break;
              }
              await this.executeReadCommand(device, command);
            }
          }
        }

        if (this.runOnce || this.stopRequested) {
          break;
        }

        if (this.intervalMs > 0) {
          await this.sleep(this.intervalMs);
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
