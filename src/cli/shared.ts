import { DeviceSession } from "../bluetooth/device-session.js";
import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";
import type { ReadHoldingRegisters } from "../core/commands.js";
import type { BluettiDevice } from "../devices/device.js";
import { createDeviceFromAdvertisement } from "../devices/registry.js";

export async function withConnectedDevice<T>(
  address: string,
  work: (context: ConnectedDeviceContext) => Promise<T>,
): Promise<T> {
  const client = new WindowsHelperClient();
  try {
    const runtime = createWindowsHelperRuntime(client);
    const transport = runtime.transportFactory.create();
    const session = new DeviceSession(address, transport);
    await session.connectAndInitialize();

    if (session.name === null) {
      throw new Error("Connected device did not report a name");
    }

    const device = createDeviceFromAdvertisement(address, session.name);
    const result = await work({ address, session, device });
    await transport.disconnect();
    return result;
  } finally {
    client.dispose();
  }
}

export async function runPollingCommands(
  session: DeviceSession,
  device: BluettiDevice,
  commands: readonly ReadHoldingRegisters[],
): Promise<PollCommandResult[]> {
  const results: PollCommandResult[] = [];
  for (const command of commands) {
    const response = await session.perform(command);
    const parsed = device.parse(command.startingAddress, command.parseResponse(response));
    results.push({
      command,
      response,
      parsed,
    });
  }
  return results;
}

export function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    if ("name" in value && "value" in value) {
      const candidate = value as { name: unknown };
      if (typeof candidate.name === "string") {
        return candidate.name;
      }
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if ((key === "serial_number" || key === "battery_serial_number") && typeof entry === "number") {
          return [key, String(entry)];
        }

        return [key, normalizeValue(entry)];
      }),
    );
  }

  return value;
}

export interface ConnectedDeviceContext {
  readonly address: string;
  readonly session: DeviceSession;
  readonly device: BluettiDevice;
}

export interface PollCommandResult {
  readonly command: ReadHoldingRegisters;
  readonly response: Uint8Array;
  readonly parsed: Record<string, unknown>;
}
