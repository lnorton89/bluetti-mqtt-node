import type { MqttClient as RawMqttClient } from "mqtt";

/**
 * Outbound MQTT publication with optional retained delivery.
 *
 * @see MqttClient.publish
 */
export interface PublishedMqttMessage {
  /** MQTT topic to publish to. */
  readonly topic: string;
  /** String payload to publish. */
  readonly payload: string;
  /** When `true`, the broker retains the message for future subscribers. */
  readonly retain?: boolean;
}

/**
 * Inbound MQTT payload paired with its exact topic.
 *
 * @see MqttClient.subscribe
 */
export interface ReceivedMqttMessage {
  /** MQTT topic the message was received on. */
  readonly topic: string;
  /** Raw message payload bytes. */
  readonly payload: Uint8Array;
}

/**
 * Minimal publish/subscribe abstraction for embedding applications.
 *
 * @remarks
 * Decouples the bridge from the raw mqtt.js client API, allowing test doubles
 * and alternative MQTT implementations.
 *
 * @see BasicMqttClient
 */
export interface MqttClient {
  /**
   * Publishes a message to the broker.
   *
   * @param message - Outbound message with topic, payload, and optional retain.
   */
  publish(message: PublishedMqttMessage): Promise<void>;
  /**
   * Subscribes to a topic and registers a callback for received messages.
   *
   * @param topic - MQTT topic to subscribe to.
   * @param onMessage - Callback invoked for each message on this topic.
   */
  subscribe(topic: string, onMessage: (message: ReceivedMqttMessage) => Promise<void> | void): Promise<void>;
}

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
export class BasicMqttClient implements MqttClient {
  /** Topic-to-callback map for active subscriptions. */
  private readonly callbacks = new Map<string, (message: ReceivedMqttMessage) => Promise<void> | void>();

  /**
   * Creates a topic-to-callback adapter over an existing mqtt.js client.
   *
   * @param rawClient - Connected mqtt.js client instance.
   * @param onMessageError - Optional error handler for callback failures.
   */
  constructor(
    private readonly rawClient: RawMqttClient,
    private readonly onMessageError: (error: unknown, message: ReceivedMqttMessage) => void = () => {},
  ) {
    this.rawClient.on("message", (topic, payload) => {
      const callback = this.callbacks.get(topic);
      if (!callback) {
        return;
      }
      const message = { topic, payload: new Uint8Array(payload) };
      try {
        void Promise.resolve(callback(message)).catch((error: unknown) => {
          this.onMessageError(error, message);
        });
      } catch (error) {
        this.onMessageError(error, message);
      }
    });
  }

  /**
   * Publishes one message using mqtt.js promise APIs.
   *
   * @param message - Outbound message with topic, payload, and optional retain.
   */
  async publish(message: PublishedMqttMessage): Promise<void> {
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
  async subscribe(topic: string, onMessage: (message: ReceivedMqttMessage) => Promise<void> | void): Promise<void> {
    const previous = this.callbacks.get(topic);
    this.callbacks.set(topic, onMessage);
    try {
      await this.rawClient.subscribeAsync(topic);
    } catch (error) {
      if (previous === undefined) {
        this.callbacks.delete(topic);
      } else {
        this.callbacks.set(topic, previous);
      }
      throw error;
    }
  }
}
