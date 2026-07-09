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

  async reconnect(address: string): Promise<void> {
    const existing = this.sessions.get(address);
    if (existing !== undefined) {
      try {
        await existing.disconnect();
      } catch {
        // The old Windows GATT object may already be disposed.
      } finally {
        this.sessions.delete(address);
      }
    }

    const session = new DeviceSession(address, this.transportFactory.create());
    await session.connectAndInitialize();
    this.sessions.set(address, session);
  }

  async disconnectAll(): Promise<void> {
    const failures: Error[] = [];

    for (const [address, session] of this.sessions.entries()) {
      try {
        await session.disconnect();
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      } finally {
        this.sessions.delete(address);
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to disconnect one or more Bluetooth sessions");
    }
  }
}
