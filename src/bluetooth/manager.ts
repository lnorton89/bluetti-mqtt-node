import { DeviceSession } from "./device-session.js";
import type { BluetoothTransportFactory } from "./transport.js";

export class MultiDeviceManager {
  private readonly sessions = new Map<string, DeviceSession>();

  constructor(
    readonly addresses: readonly string[],
    private readonly transportFactory: BluetoothTransportFactory,
  ) {}

  async connectAll(): Promise<void> {
    for (const address of this.addresses) {
      if (this.sessions.has(address)) {
        continue;
      }

      const session = new DeviceSession(address, this.transportFactory.create());
      await session.connectAndInitialize();
      this.sessions.set(address, session);
    }
  }

  isReady(address: string): boolean {
    return this.sessions.get(address)?.isReady ?? false;
  }

  getName(address: string): string {
    const name = this.sessions.get(address)?.name;
    if (name === null || name === undefined) {
      throw new Error(`No connected device name for ${address}`);
    }
    return name;
  }

  getSession(address: string): DeviceSession {
    const session = this.sessions.get(address);
    if (session === undefined) {
      throw new Error(`No active session for ${address}`);
    }
    return session;
  }

  async disconnectAll(): Promise<void> {
    for (const [address, session] of this.sessions.entries()) {
      await session.disconnect();
      this.sessions.delete(address);
    }
  }
}
