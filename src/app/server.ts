import { MultiDeviceManager } from "../bluetooth/manager.js";
import type { BluetoothTransportFactory } from "../bluetooth/transport.js";
import { DeviceCommand } from "../core/commands.js";
import { EventBus } from "../core/event-bus.js";
import type { BluettiDevice } from "../devices/device.js";
import { BluettiMqttBridge, type BluettiMqttClientOptions } from "../mqtt/client.js";
import { DeviceHandler } from "./device-handler.js";

export interface ServerOptions {
  readonly addresses: readonly string[];
  readonly transportFactory: BluetoothTransportFactory;
  readonly mqtt: BluettiMqttClientOptions;
  readonly intervalMs?: number;
  readonly runOnce?: boolean;
}

export class BluettiMqttServer {
  readonly bus = new EventBus<BluettiDevice, BluettiDevice, DeviceCommand>();
  readonly manager: MultiDeviceManager;
  readonly deviceHandler: DeviceHandler;
  readonly mqttBridge: BluettiMqttBridge;

  constructor(options: ServerOptions) {
    this.manager = new MultiDeviceManager(options.addresses, options.transportFactory);
    this.deviceHandler = new DeviceHandler(this.manager, this.bus, options.intervalMs ?? 0, options.runOnce ?? false);
    this.mqttBridge = new BluettiMqttBridge(this.bus, options.mqtt);
  }

  async connectAll(): Promise<void> {
    await this.deviceHandler.connectAll();
  }

  async stop(): Promise<void> {
    this.deviceHandler.stop();
  }

  async run(): Promise<void> {
    await this.mqttBridge.run();
    try {
      await this.deviceHandler.run();
    } finally {
      await this.manager.disconnectAll();
      await this.mqttBridge.stop();
    }
  }
}
