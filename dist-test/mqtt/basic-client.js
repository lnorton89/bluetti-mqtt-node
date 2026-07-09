/**
 * Thin topic-to-callback adapter over an existing mqtt.js client.
 *
 * @remarks
 * Callback failures are reported through `onMessageError` to avoid unhandled
 * promise rejections in long-running consumers. Subscription is transactional:
 * the previous callback is restored if the native subscribe fails.
 *
 * @see MqttClient
 */
export class BasicMqttClient {
    rawClient;
    onMessageError;
    /** Topic-to-callback map for active subscriptions. */
    callbacks = new Map();
    /**
     * Creates a topic-to-callback adapter over an existing mqtt.js client.
     *
     * @param rawClient - Connected mqtt.js client instance.
     * @param onMessageError - Optional error handler for callback failures.
     */
    constructor(rawClient, onMessageError = () => { }) {
        this.rawClient = rawClient;
        this.onMessageError = onMessageError;
        this.rawClient.on("message", (topic, payload) => {
            const callback = this.callbacks.get(topic);
            if (!callback) {
                return;
            }
            const message = { topic, payload: new Uint8Array(payload) };
            try {
                void Promise.resolve(callback(message)).catch((error) => {
                    this.onMessageError(error, message);
                });
            }
            catch (error) {
                this.onMessageError(error, message);
            }
        });
    }
    /**
     * Publishes one message using mqtt.js promise APIs.
     *
     * @param message - Outbound message with topic, payload, and optional retain.
     */
    async publish(message) {
        await this.rawClient.publishAsync(message.topic, message.payload, { retain: message.retain ?? false });
    }
    /**
     * Subscribes transactionally, restoring the previous callback on failure.
     *
     * @param topic - MQTT topic to subscribe to.
     * @param onMessage - Callback invoked for each message on this topic.
     * @throws {Error} When the native subscribe fails (previous callback is
     *   restored).
     */
    async subscribe(topic, onMessage) {
        const previous = this.callbacks.get(topic);
        this.callbacks.set(topic, onMessage);
        try {
            await this.rawClient.subscribeAsync(topic);
        }
        catch (error) {
            if (previous === undefined) {
                this.callbacks.delete(topic);
            }
            else {
                this.callbacks.set(topic, previous);
            }
            throw error;
        }
    }
}
