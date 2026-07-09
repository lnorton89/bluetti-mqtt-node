import { DeviceSession } from "@bluetooth/device-session.js";
import { WindowsHelperClient, createWindowsHelperRuntime } from "@bluetooth/helper-client.js";
import type { BluetoothTransport } from "@bluetooth/transport.js";
import type { ReadHoldingRegisters } from "@core/commands.js";
import type { BluettiDevice } from "@devices/device.js";
import { createDeviceFromAdvertisement } from "@devices/registry.js";

/**
 * User-facing argument or configuration error.
 *
 * Rendered to stderr with exit code 1 by {@link runCli}.
 *
 * @see runCli
 */
export class UsageError extends Error {}

/**
 * Control-flow error used to print help and exit successfully.
 *
 * Rendered to stdout with exit code 0 by {@link runCli}.
 *
 * @see runCli
 */
export class HelpError extends Error {}

/**
 * Runs work with one initialized device and always releases native resources.
 *
 * @param address - Bluetooth MAC address to connect.
 * @param work - Callback receiving the connected device context.
 * @returns The result of `work`.
 * @throws {Error} When connection or initialization fails.
 *
 * @remarks
 * The original operation error takes precedence over a secondary disconnect
 * failure; successful work still reports disconnect failures to the caller.
 * The helper client is always disposed in the `finally` block.
 *
 * @see ConnectedDeviceContext
 */
export async function withConnectedDevice<T>(
  address: string,
  work: (context: ConnectedDeviceContext) => Promise<T>,
): Promise<T> {
  const client = new WindowsHelperClient();
  let transport: BluetoothTransport | null = null;
  let operationFailed = false;
  try {
    const runtime = createWindowsHelperRuntime(client);
    transport = runtime.transportFactory.create();
    const session = new DeviceSession(address, transport);
    await session.connectAndInitialize();

    if (session.name === null) {
      throw new Error("Connected device did not report a name");
    }

    const device = createDeviceFromAdvertisement(address, session.name);
    return await work({ address, session, device });
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    let disconnectError: unknown;
    if (transport !== null) {
      try {
        await transport.disconnect();
      } catch (error) {
        if (!operationFailed) {
          disconnectError = error;
        }
      }
    }
    client.dispose();
    if (disconnectError !== undefined) {
      throw disconnectError;
    }
  }
}

/**
 * Executes and decodes a list of read commands in order.
 *
 * @param session - Initialized device session.
 * @param device - Device model for field decoding.
 * @param commands - Ordered list of read commands to execute.
 * @returns Array of results containing the command, raw response, and parsed
 *   fields for each read.
 * @throws {BadConnectionError} When the session is lost mid-sequence.
 * @throws {CommandTimeoutError} When a command times out.
 *
 * @see PollCommandResult
 */
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

/**
 * Converts BigInt and enum-rich values into JSON-safe output.
 *
 * @param value - Value that may contain `bigint`, enums, or nested objects.
 * @returns A JSON-safe representation where `bigint` becomes `string` and
 *   enum values become their name.
 *
 * @remarks
 * Also converts `serial_number` and `battery_serial_number` numeric values to
 * strings to preserve formatting in CLI output.
 */
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

/**
 * Device objects supplied to a connected CLI operation.
 *
 * @see withConnectedDevice
 */
export interface ConnectedDeviceContext {
  /** Bluetooth MAC address of the connected device. */
  readonly address: string;
  /** Initialized device session for command execution. */
  readonly session: DeviceSession;
  /** Device model for field decoding. */
  readonly device: BluettiDevice;
}

/**
 * Raw and decoded result from one polling command.
 *
 * @see runPollingCommands
 */
export interface PollCommandResult {
  /** The read command that was executed. */
  readonly command: ReadHoldingRegisters;
  /** Raw response bytes from the device. */
  readonly response: Uint8Array;
  /** Decoded field map from parsing the response. */
  readonly parsed: Record<string, unknown>;
}

/**
 * Returns whether standard short or long help flags are present.
 *
 * @param argv - Command-line arguments to check.
 * @returns `true` when `--help` or `-h` is present.
 */
export function hasHelpFlag(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

/**
 * Requires exactly one validated Bluetooth address argument.
 *
 * @param argv - Command-line arguments (excluding the executable).
 * @param helpText - Usage text shown on error.
 * @returns The validated, normalized Bluetooth address.
 * @throws {HelpError} When `--help` or `-h` is present.
 * @throws {UsageError} When the argument count is wrong or the address is
 *   invalid.
 *
 * @see validateBluetoothAddress
 */
export function requireSingleAddressArg(argv: readonly string[], helpText: string): string {
  if (hasHelpFlag(argv)) {
    throw new HelpError(helpText);
  }

  if (argv.length !== 1 || !argv[0]) {
    throw new UsageError(helpText);
  }

  return validateBluetoothAddress(argv[0]);
}

/**
 * Accepts zero or one validated Bluetooth address argument.
 *
 * @param argv - Command-line arguments (excluding the executable).
 * @param helpText - Usage text shown on error.
 * @returns The validated address, or `undefined` when no argument is given.
 * @throws {HelpError} When `--help` or `-h` is present.
 * @throws {UsageError} When more than one argument is given or the address is
 *   invalid.
 *
 * @see validateBluetoothAddress
 */
export function optionalSingleAddressArg(argv: readonly string[], helpText: string): string | undefined {
  if (hasHelpFlag(argv)) {
    throw new HelpError(helpText);
  }

  if (argv.length > 1) {
    throw new UsageError(helpText);
  }

  return argv[0] ? validateBluetoothAddress(argv[0]) : undefined;
}

/**
 * Runs a CLI main function with consistent exit-code and error rendering.
 *
 * @param main - Async entry point for the CLI command.
 *
 * @remarks
 * Catches {@link HelpError} (prints to stdout, exit 0), {@link UsageError}
 * (prints to stderr, exit 1), and all other errors (prints stack to stderr,
 * exit 1). Uses `process.exitCode` rather than `process.exit` so pending I/O
 * can flush.
 */
export function runCli(main: () => Promise<void>): void {
  void main().catch((error: unknown) => {
    if (error instanceof HelpError) {
      console.log(error.message);
      process.exitCode = 0;
      return;
    }

    if (error instanceof UsageError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

/**
 * Installs idempotent SIGINT/SIGTERM cleanup and returns a listener disposer.
 *
 * @param onSignal - Cleanup callback invoked on the first signal.
 * @returns A function that removes the signal handlers.
 *
 * @remarks
 * The handler is idempotent: repeated signals are ignored after the first
 * invocation. Errors from `onSignal` are printed to stderr with exit code 1.
 */
export function installSignalHandlers(onSignal: () => void | Promise<void>): () => void {
  let stopping = false;

  const handler = (): void => {
    if (stopping) {
      return;
    }

    stopping = true;
    void Promise.resolve(onSignal()).catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);

  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

/**
 * Normalizes accepted MAC formats to uppercase colon-separated notation.
 *
 * @param address - Bluetooth MAC in colon, hyphen, or compact notation.
 * @returns Normalized address in `XX:XX:XX:XX:XX:XX` format.
 * @throws {UsageError} When the address does not match any accepted format.
 */
export function validateBluetoothAddress(address: string): string {
  const normalized = address.trim().toUpperCase();
  const patterns = [
    /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/,
    /^([0-9A-F]{2}-){5}[0-9A-F]{2}$/,
    /^[0-9A-F]{12}$/,
  ];

  if (!patterns.some((pattern) => pattern.test(normalized))) {
    throw new UsageError(
      `Invalid Bluetooth address '${address}'. Expected 12 hex digits, for example 24:4C:AB:2C:24:8E.`,
    );
  }

  if (normalized.includes(":")) {
    return normalized;
  }

  const compact = normalized.replace(/-/g, "");
  return compact.match(/.{2}/g)?.join(":") ?? normalized;
}
