/**
 * Indicates that the active GATT session cannot safely continue.
 *
 * Thrown when the transport reports a disposed object, an unreachable device,
 * or when an unexpected AT control message arrives instead of a MODBUS
 * response. The {@link MultiDeviceManager} treats this as a signal to replace
 * the session via {@link MultiDeviceManager.reconnect}.
 *
 * @see DeviceSession.perform
 * @see MultiDeviceManager.reconnect
 */
export declare class BadConnectionError extends Error {
}
/**
 * Indicates that a complete MODBUS response was not received in time.
 *
 * Thrown by {@link DeviceSession.perform} when the command timeout elapses
 * before a complete, validated response arrives. The session transitions to
 * the `CommandErrorWait` state, allowing recovery on the next command.
 *
 * @see DeviceSession.perform
 * @see DeviceSessionState.CommandErrorWait
 */
export declare class CommandTimeoutError extends Error {
}
/**
 * Represents a MODBUS exception returned by the device.
 *
 * The `code` property carries the raw MODBUS exception code so callers can
 * distinguish between busy responses and other exceptions.
 *
 * @see DeviceBusyError
 * @see DeviceSession.buildModbusException
 */
export declare class ModbusError extends Error {
    readonly code: number;
    /**
     * @param message - Human-readable description including the exception code.
     * @param code - Raw MODBUS exception code from the response frame.
     */
    constructor(message: string, code: number);
}
/**
 * MODBUS acknowledgement used by Bluetti while the device is occupied.
 *
 * Corresponds to MODBUS exception code `5` (acknowledge). The
 * {@link DeviceHandler} treats this as a transient condition and applies
 * adaptive backoff rather than treating it as a hard error.
 *
 * @see DeviceHandler
 * @see ModbusError
 */
export declare class DeviceBusyError extends ModbusError {
    /**
     * @param message - Human-readable description (default: `"Device reported MODBUS busy"`).
     * @param code - MODBUS exception code (default: `5`).
     */
    constructor(message?: string, code?: number);
}
/**
 * Indicates that a received frame could not be decoded safely.
 *
 * Thrown when a response fails CRC validation or when the notification payload
 * exceeds the expected response size. Unlike {@link BadConnectionError}, this
 * does not necessarily mean the connection is unusable; the session enters
 * `CommandErrorWait` and can retry.
 *
 * @see DeviceSessionState.CommandErrorWait
 */
export declare class ParseError extends Error {
}
