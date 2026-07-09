/**
 * Parsed telemetry published by the polling layer to parser listeners.
 *
 * @typeParam Device - Device type that produced this telemetry.
 *
 * @see EventBus.publishParserMessage
 */
export interface ParserMessage<Device> {
    /** Device that produced this telemetry. */
    readonly device: Device;
    /** Decoded field map from one or more register reads. */
    readonly parsed: Record<string, unknown>;
}
/**
 * Validated device command dispatched by an external control surface.
 *
 * @typeParam Device - Target device type.
 * @typeParam Command - Command type to execute.
 *
 * @see EventBus.publishCommandMessage
 */
export interface CommandMessage<Device, Command> {
    /** Target device for the command. */
    readonly device: Device;
    /** MODBUS command to execute on the target device. */
    readonly command: Command;
}
/** Listener callback that may be sync or async. */
type AsyncListener<T> = (message: T) => Promise<void> | void;
/**
 * Asynchronous fan-out bus connecting polling and external transports.
 *
 * The bus maintains two independent listener sets: parser listeners receive
 * decoded telemetry, while command listeners receive validated write commands.
 * Both are invoked in parallel via `Promise.all`.
 *
 * @typeParam ParserDevice - Device type carried in parser messages.
 * @typeParam CommandDevice - Device type carried in command messages.
 * @typeParam CommandType - Command type dispatched to command listeners.
 *
 * @remarks
 * Registration returns a disposer function so resource owners can detach
 * callbacks before shutting down their network or native dependencies.
 * Listeners are called synchronously in registration order but their returned
 * promises are awaited together.
 *
 * @example
 * ```ts
 * const bus = new EventBus<BluettiDevice, BluettiDevice, DeviceCommand>();
 * const dispose = bus.addParserListener(async (msg) => {
 *   console.log(msg.parsed);
 * });
 * // ... later
 * dispose();
 * ```
 *
 * @see BluettiMqttBridge
 * @see DeviceHandler
 */
export declare class EventBus<ParserDevice, CommandDevice, CommandType> {
    /** Registered parser (telemetry) listeners. */
    private readonly parserListeners;
    /** Registered command listeners. */
    private readonly commandListeners;
    /**
     * Registers a telemetry listener and returns its disposer.
     *
     * @param listener - Async or sync callback invoked for each parser message.
     * @returns A function that removes the listener when called.
     */
    addParserListener(listener: AsyncListener<ParserMessage<ParserDevice>>): () => void;
    /**
     * Registers a command listener and returns its disposer.
     *
     * @param listener - Async or sync callback invoked for each command message.
     * @returns A function that removes the listener when called.
     */
    addCommandListener(listener: AsyncListener<CommandMessage<CommandDevice, CommandType>>): () => void;
    /**
     * Publishes a parser message and waits for every current listener to complete.
     *
     * @param message - Telemetry to deliver to all parser listeners.
     * @returns A promise that resolves when all listeners have settled.
     */
    publishParserMessage(message: ParserMessage<ParserDevice>): Promise<void>;
    /**
     * Publishes a command message and waits for every current listener to complete.
     *
     * @param message - Command to deliver to all command listeners.
     * @returns A promise that resolves when all listeners have settled.
     */
    publishCommandMessage(message: CommandMessage<CommandDevice, CommandType>): Promise<void>;
}
export {};
