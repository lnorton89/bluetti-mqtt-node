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
export class EventBus {
    /** Registered parser (telemetry) listeners. */
    parserListeners = new Set();
    /** Registered command listeners. */
    commandListeners = new Set();
    /**
     * Registers a telemetry listener and returns its disposer.
     *
     * @param listener - Async or sync callback invoked for each parser message.
     * @returns A function that removes the listener when called.
     */
    addParserListener(listener) {
        this.parserListeners.add(listener);
        return () => {
            this.parserListeners.delete(listener);
        };
    }
    /**
     * Registers a command listener and returns its disposer.
     *
     * @param listener - Async or sync callback invoked for each command message.
     * @returns A function that removes the listener when called.
     */
    addCommandListener(listener) {
        this.commandListeners.add(listener);
        return () => {
            this.commandListeners.delete(listener);
        };
    }
    /**
     * Publishes a parser message and waits for every current listener to complete.
     *
     * @param message - Telemetry to deliver to all parser listeners.
     * @returns A promise that resolves when all listeners have settled.
     */
    async publishParserMessage(message) {
        await Promise.all([...this.parserListeners].map(async (listener) => listener(message)));
    }
    /**
     * Publishes a command message and waits for every current listener to complete.
     *
     * @param message - Command to deliver to all command listeners.
     * @returns A promise that resolves when all listeners have settled.
     */
    async publishCommandMessage(message) {
        await Promise.all([...this.commandListeners].map(async (listener) => listener(message)));
    }
}
