import { MultiDeviceManager } from "../bluetooth/manager.js";
import type { BluetoothTransportFactory } from "../bluetooth/transport.js";
import { DeviceCommand } from "../core/commands.js";
import { EventBus } from "../core/event-bus.js";
import { ConsoleLogger, type Logger } from "../core/logger.js";
import type { BluettiDevice } from "../devices/device.js";
import { BluettiMqttBridge, type BluettiMqttClientOptions } from "../mqtt/client.js";
import { DeviceHandler } from "./device-handler.js";

export interface ServerOptions {
  readonly addresses: readonly string[];
  readonly transportFactory: BluetoothTransportFactory;
  readonly mqtt: BluettiMqttClientOptions;
  readonly intervalMs?: number;
  readonly runOnce?: boolean;
  readonly logger?: Logger;
}

export class BluettiMqttServer {
  readonly bus = new EventBus<BluettiDevice, BluettiDevice, DeviceCommand>();
  readonly manager: MultiDeviceManager;
  readonly deviceHandler: DeviceHandler;
  readonly mqttBridge: BluettiMqttBridge;
  readonly logger: Logger;

  constructor(options: ServerOptions) {
    this.logger = options.logger ?? new ConsoleLogger("info");
    this.manager = new MultiDeviceManager(options.addresses, options.transportFactory);
    this.deviceHandler = new DeviceHandler(this.manager, this.bus, options.intervalMs ?? 0, options.runOnce ?? false);
    this.mqttBridge = new BluettiMqttBridge(this.bus, options.mqtt, undefined, this.logger);
  }

  async connectAll(): Promise<void> {
    await this.deviceHandler.connectAll();
  }

  async stop(): Promise<void> {
    this.deviceHandler.stop();
  }

  async run(): Promise<void> {
    await this.mqttBridge.run();
    this.logger.info("Starting device polling", { addresses: this.manager.addresses });
    try {
      await this.deviceHandler.run();
    } finally {
      await this.manager.disconnectAll();
      await this.mqttBridge.stop();
      this.logger.info("Stopped device polling", { addresses: this.manager.addresses });
    }
  }
}
