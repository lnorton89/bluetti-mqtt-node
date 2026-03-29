export interface ParserMessage<Device> {
  readonly device: Device;
  readonly parsed: Record<string, unknown>;
}

export interface CommandMessage<Device, Command> {
  readonly device: Device;
  readonly command: Command;
}

type AsyncListener<T> = (message: T) => Promise<void> | void;

export class EventBus<ParserDevice, CommandDevice, CommandType> {
  private readonly parserListeners = new Set<AsyncListener<ParserMessage<ParserDevice>>>();
  private readonly commandListeners = new Set<AsyncListener<CommandMessage<CommandDevice, CommandType>>>();

  addParserListener(listener: AsyncListener<ParserMessage<ParserDevice>>): void {
    this.parserListeners.add(listener);
  }

  addCommandListener(listener: AsyncListener<CommandMessage<CommandDevice, CommandType>>): void {
    this.commandListeners.add(listener);
  }

  async publishParserMessage(message: ParserMessage<ParserDevice>): Promise<void> {
    await Promise.all([...this.parserListeners].map(async (listener) => listener(message)));
  }

  async publishCommandMessage(message: CommandMessage<CommandDevice, CommandType>): Promise<void> {
    await Promise.all([...this.commandListeners].map(async (listener) => listener(message)));
  }
}
