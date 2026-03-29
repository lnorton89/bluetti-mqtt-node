import { DeviceCommand } from "../core/commands.js";
import { BadConnectionError, ModbusError, ParseError } from "./errors.js";
import type { BluetoothTransport } from "./transport.js";

export enum DeviceSessionState {
  NotConnected = "not_connected",
  Connected = "connected",
  Ready = "ready",
  PerformingCommand = "performing_command",
  CommandErrorWait = "command_error_wait",
  Disconnecting = "disconnecting",
}

export class DeviceSession {
  static readonly WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
  static readonly NOTIFY_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";
  static readonly DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb";

  readonly address: string;
  readonly transport: BluetoothTransport;
  state = DeviceSessionState.NotConnected;
  name: string | null = null;
  private currentCommand: DeviceCommand | null = null;
  private responseBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private pendingResponse:
    | {
        resolve: (value: Uint8Array) => void;
        reject: (reason?: unknown) => void;
      }
    | null = null;

  constructor(address: string, transport: BluetoothTransport) {
    this.address = address;
    this.transport = transport;
  }

  get isReady(): boolean {
    return this.state === DeviceSessionState.Ready || this.state === DeviceSessionState.PerformingCommand;
  }

  async connectAndInitialize(): Promise<void> {
    await this.transport.connect(this.address);
    this.state = DeviceSessionState.Connected;

    const rawName = await this.transport.readCharacteristic(DeviceSession.DEVICE_NAME_UUID);
    this.name = Buffer.from(rawName).toString("ascii");

    await this.transport.subscribe(DeviceSession.NOTIFY_UUID, (data) => {
      this.handleNotification(data);
    });
    this.state = DeviceSessionState.Ready;
  }

  async perform(command: DeviceCommand): Promise<Uint8Array> {
    if (!this.isReady) {
      throw new BadConnectionError(`Device ${this.address} is not ready`);
    }

    this.state = DeviceSessionState.PerformingCommand;
    this.currentCommand = command;
    this.responseBuffer = new Uint8Array(0);

    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      this.pendingResponse = { resolve, reject };
    });

    try {
      await this.transport.writeCharacteristic(DeviceSession.WRITE_UUID, command.toBytes());
    } catch (error) {
      this.state = DeviceSessionState.Disconnecting;
      this.pendingResponse?.reject(error);
      this.pendingResponse = null;
      throw error;
    }

    const response = await responsePromise;
    this.state = DeviceSessionState.Ready;
    this.currentCommand = null;
    return response;
  }

  buildModbusException(command: DeviceCommand, response: Uint8Array): ModbusError {
    return new ModbusError(`MODBUS exception for function ${command.functionCode}: code ${response[2] ?? -1}`);
  }

  private handleNotification(data: Uint8Array): void {
    if (this.pendingResponse === null || this.currentCommand === null) {
      return;
    }

    if (isAsciiControlMessage(data)) {
      this.rejectPending(new BadConnectionError("Received AT control notification instead of MODBUS response"));
      this.state = DeviceSessionState.Disconnecting;
      return;
    }

    this.responseBuffer = concatBytes(this.responseBuffer, data);

    if (this.currentCommand.isExceptionResponse(this.responseBuffer)) {
      this.rejectPending(this.buildModbusException(this.currentCommand, this.responseBuffer));
      this.state = DeviceSessionState.Ready;
      return;
    }

    if (this.responseBuffer.length === this.currentCommand.responseSize()) {
      if (this.currentCommand.isValidResponse(this.responseBuffer)) {
        this.resolvePending(this.responseBuffer);
        this.state = DeviceSessionState.Ready;
      } else {
        this.rejectPending(new ParseError("Response CRC validation failed"));
        this.state = DeviceSessionState.CommandErrorWait;
      }
      return;
    }

    if (this.responseBuffer.length > this.currentCommand.responseSize()) {
      this.rejectPending(new ParseError("Notification payload exceeded expected response size"));
      this.state = DeviceSessionState.CommandErrorWait;
    }
  }

  private resolvePending(response: Uint8Array): void {
    this.pendingResponse?.resolve(response);
    this.pendingResponse = null;
  }

  private rejectPending(error: unknown): void {
    this.pendingResponse?.reject(error);
    this.pendingResponse = null;
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBufferLike> {
  const combined = new Uint8Array(new ArrayBuffer(left.length + right.length));
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

function isAsciiControlMessage(data: Uint8Array): boolean {
  const text = Buffer.from(data).toString("ascii");
  return text === "AT+NAME?\r" || text === "AT+ADV?\r";
}
