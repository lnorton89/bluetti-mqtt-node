using System.Text.Json;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Foundation;
using Windows.Storage.Streams;

var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    cts.Cancel();
};

await using var protocol = new HelperProtocol(Console.In, Console.Out);
await protocol.RunAsync(cts.Token);

internal sealed class HelperProtocol : IAsyncDisposable
{
    private readonly TextReader _input;
    private readonly TextWriter _output;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Dictionary<string, DeviceConnection> _connections = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public HelperProtocol(TextReader input, TextWriter output)
    {
        _input = input;
        _output = output;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        await WriteEventAsync(new HelperEvent("ready", new { capabilities = new[] { "scan", "connect", "gatt" } }), cancellationToken);

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await _input.ReadLineAsync();
            if (line is null)
            {
                break;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            HelperRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<HelperRequest>(line, _jsonOptions);
            }
            catch (JsonException ex)
            {
                await WriteErrorAsync("invalid_json", ex.Message, cancellationToken);
                continue;
            }

            if (request is null)
            {
                await WriteErrorAsync("invalid_request", "Request payload was empty.", cancellationToken);
                continue;
            }

            try
            {
                switch (request.Command)
                {
                    case "ping":
                        await WriteResponseAsync(request.Id, new { ok = true }, cancellationToken);
                        break;
                    case "scan":
                        await HandleScanAsync(request, cancellationToken);
                        break;
                    case "connect":
                        await HandleConnectAsync(request, cancellationToken);
                        break;
                    case "disconnect":
                        await HandleDisconnectAsync(request, cancellationToken);
                        break;
                    case "readCharacteristic":
                        await HandleReadCharacteristicAsync(request, cancellationToken);
                        break;
                    case "writeCharacteristic":
                        await HandleWriteCharacteristicAsync(request, cancellationToken);
                        break;
                    case "subscribe":
                        await HandleSubscribeAsync(request, cancellationToken);
                        break;
                    default:
                        await WriteErrorAsync("unsupported_command", $"Unsupported command '{request.Command}'.", cancellationToken, request.Id);
                        break;
                }
            }
            catch (Exception ex)
            {
                await WriteErrorAsync("command_failed", ex.Message, cancellationToken, request.Id);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var connection in _connections.Values)
        {
            await connection.DisposeAsync();
        }

        _connections.Clear();
        _writeLock.Dispose();
    }

    private async Task HandleScanAsync(HelperRequest request, CancellationToken cancellationToken)
    {
        var timeoutMs = request.Arguments?.GetPropertyOrDefault("timeoutMs")?.GetInt32() ?? 5000;
        var results = await ScanAsync(timeoutMs, cancellationToken);
        await WriteResponseAsync(request.Id, new { devices = results }, cancellationToken);
    }

    private async Task HandleConnectAsync(HelperRequest request, CancellationToken cancellationToken)
    {
        var addressText = request.Arguments.RequireString("address");
        var address = ParseBluetoothAddress(addressText);
        var connection = await DeviceConnection.CreateAsync(
            address,
            notification => WriteEventAsync(new HelperEvent("notification", notification), CancellationToken.None));

        _connections[connection.SessionId] = connection;
        await WriteResponseAsync(
            request.Id,
            new
            {
                sessionId = connection.SessionId,
                address = addressText,
                name = connection.Name
            },
            cancellationToken);
    }

    private async Task HandleDisconnectAsync(HelperRequest request, CancellationToken cancellationToken)
    {
        var sessionId = request.Arguments.RequireString("sessionId");
        if (_connections.Remove(sessionId, out var connection))
        {
            await connection.DisposeAsync();
        }

        await WriteResponseAsync(request.Id, new { ok = true }, cancellationToken);
    }

    private async Task HandleReadCharacteristicAsync(HelperRequest request, CancellationToken cancellationToken)
    {
        var connection = GetConnection(request);
        var uuid = request.Arguments.RequireString("uuid");
        var data = await connection.ReadCharacteristicAsync(uuid);
        await WriteResponseAsync(
            request.Id,
            new
            {
                dataBase64 = Convert.ToBase64String(data)
            },
            cancellationToken);
    }

    private async Task HandleWriteCharacteristicAsync(HelperRequest request, CancellationToken cancellationToken)
    {
        var connection = GetConnection(request);
        var uuid = request.Arguments.RequireString("uuid");
        var dataBase64 = request.Arguments.RequireString("dataBase64");
        var withoutResponse = request.Arguments.GetPropertyOrDefaultNullable("withoutResponse")?.GetBoolean() ?? false;
        await connection.WriteCharacteristicAsync(uuid, Convert.FromBase64String(dataBase64), withoutResponse);
        await WriteResponseAsync(request.Id, new { ok = true }, cancellationToken);
    }

    private async Task HandleSubscribeAsync(HelperRequest request, CancellationToken cancellationToken)
    {
        var connection = GetConnection(request);
        var uuid = request.Arguments.RequireString("uuid");
        await connection.SubscribeAsync(uuid);
        await WriteResponseAsync(request.Id, new { ok = true }, cancellationToken);
    }

    private DeviceConnection GetConnection(HelperRequest request)
    {
        var sessionId = request.Arguments.RequireString("sessionId");
        if (!_connections.TryGetValue(sessionId, out var connection))
        {
            throw new InvalidOperationException($"Unknown session '{sessionId}'.");
        }

        return connection;
    }

    private static async Task<IReadOnlyList<ScanDevice>> ScanAsync(int timeoutMs, CancellationToken cancellationToken)
    {
        var devices = new Dictionary<ulong, ScanDevice>();
        var watcher = new BluetoothLEAdvertisementWatcher
        {
            ScanningMode = BluetoothLEScanningMode.Active
        };

        TypedEventHandler<BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementReceivedEventArgs> handler = (_, args) =>
        {
            var name = args.Advertisement.LocalName;
            if (string.IsNullOrWhiteSpace(name))
            {
                return;
            }

            devices[args.BluetoothAddress] = new ScanDevice(
                FormatBluetoothAddress(args.BluetoothAddress),
                name,
                args.RawSignalStrengthInDBm);
        };
        watcher.Received += handler;

        watcher.Start();
        try
        {
            await Task.Delay(timeoutMs, cancellationToken);
        }
        finally
        {
            watcher.Stop();
            watcher.Received -= handler;
        }

        return devices.Values.OrderByDescending(device => device.Rssi).ToArray();
    }

    private async Task WriteResponseAsync(string? id, object payload, CancellationToken cancellationToken)
    {
        await WriteMessageAsync(new { type = "response", id, payload }, cancellationToken);
    }

    private async Task WriteErrorAsync(string code, string message, CancellationToken cancellationToken, string? id = null)
    {
        await WriteMessageAsync(new { type = "error", id, error = new { code, message } }, cancellationToken);
    }

    private async Task WriteEventAsync(HelperEvent helperEvent, CancellationToken cancellationToken)
    {
        await WriteMessageAsync(new { type = "event", name = helperEvent.Name, payload = helperEvent.Payload }, cancellationToken);
    }

    private async Task WriteMessageAsync(object message, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(message, _jsonOptions);
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await _output.WriteLineAsync(json.AsMemory(), cancellationToken);
            await _output.FlushAsync();
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static ulong ParseBluetoothAddress(string address)
    {
        var normalized = address.Replace(":", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal);
        if (normalized.Length != 12)
        {
            throw new FormatException($"Bluetooth address '{address}' must have 12 hex digits.");
        }

        return Convert.ToUInt64(normalized, 16);
    }

    private static string FormatBluetoothAddress(ulong bluetoothAddress)
    {
        var bytes = BitConverter.GetBytes(bluetoothAddress);
        return string.Join(":", bytes.Take(6).Reverse().Select(value => value.ToString("X2")));
    }
}

internal sealed class DeviceConnection : IAsyncDisposable
{
    private readonly BluetoothLEDevice _device;
    private readonly Func<NotificationEvent, Task> _emitNotification;
    private readonly Dictionary<Guid, GattCharacteristic> _characteristics = new();
    private readonly Dictionary<Guid, TypedEventHandler<GattCharacteristic, GattValueChangedEventArgs>> _handlers = new();
    private IReadOnlyList<GattDeviceService>? _services;

    private DeviceConnection(BluetoothLEDevice device, Func<NotificationEvent, Task> emitNotification)
    {
        _device = device;
        _emitNotification = emitNotification;
        SessionId = Guid.NewGuid().ToString("N");
        Name = string.IsNullOrWhiteSpace(device.Name) ? "Unknown" : device.Name;
    }

    public string SessionId { get; }

    public string Name { get; }

    public static async Task<DeviceConnection> CreateAsync(ulong address, Func<NotificationEvent, Task> emitNotification)
    {
        var device = await BluetoothLEDevice.FromBluetoothAddressAsync(address);
        if (device is null)
        {
            throw new InvalidOperationException($"Could not connect to Bluetooth device {address:X12}.");
        }

        return new DeviceConnection(device, emitNotification);
    }

    public async Task<byte[]> ReadCharacteristicAsync(string uuidText)
    {
        var characteristic = await GetCharacteristicAsync(ParseUuid(uuidText));
        var result = await characteristic.ReadValueAsync(BluetoothCacheMode.Uncached);
        EnsureSuccess(result.Status, $"read characteristic {uuidText}");
        return ReadBytes(result.Value);
    }

    public async Task WriteCharacteristicAsync(string uuidText, byte[] data, bool withoutResponse)
    {
        var characteristic = await GetCharacteristicAsync(ParseUuid(uuidText));
        var writer = new DataWriter();
        writer.WriteBytes(data);
        var option = withoutResponse ? GattWriteOption.WriteWithoutResponse : GattWriteOption.WriteWithResponse;
        var status = await characteristic.WriteValueAsync(writer.DetachBuffer(), option);
        EnsureSuccess(status, $"write characteristic {uuidText}");
    }

    public async Task SubscribeAsync(string uuidText)
    {
        var uuid = ParseUuid(uuidText);
        var characteristic = await GetCharacteristicAsync(uuid);
        if (_handlers.ContainsKey(uuid))
        {
            return;
        }

        TypedEventHandler<GattCharacteristic, GattValueChangedEventArgs> handler = (_sender, args) =>
        {
            var data = ReadBytes(args.CharacteristicValue);
            _ = _emitNotification(new NotificationEvent(SessionId, uuidText, Convert.ToBase64String(data)));
        };

        characteristic.ValueChanged += handler;
        var status = await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
            GattClientCharacteristicConfigurationDescriptorValue.Notify);
        EnsureSuccess(status, $"subscribe to characteristic {uuidText}");
        _handlers[uuid] = handler;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var pair in _handlers)
        {
            if (_characteristics.TryGetValue(pair.Key, out var characteristic))
            {
                characteristic.ValueChanged -= pair.Value;
                await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
                    GattClientCharacteristicConfigurationDescriptorValue.None);
            }
        }

        if (_services is not null)
        {
            foreach (var service in _services)
            {
                service.Dispose();
            }
        }

        _device.Dispose();
    }

    private async Task<GattCharacteristic> GetCharacteristicAsync(Guid uuid)
    {
        if (_characteristics.TryGetValue(uuid, out var characteristic))
        {
            return characteristic;
        }

        var services = await GetServicesAsync();
        foreach (var service in services)
        {
            var result = await service.GetCharacteristicsForUuidAsync(uuid, BluetoothCacheMode.Uncached);
            if (result.Status != GattCommunicationStatus.Success || result.Characteristics.Count == 0)
            {
                continue;
            }

            characteristic = result.Characteristics[0];
            _characteristics[uuid] = characteristic;
            return characteristic;
        }

        throw new InvalidOperationException($"Characteristic {uuid} was not found on device {Name}.");
    }

    private async Task<IReadOnlyList<GattDeviceService>> GetServicesAsync()
    {
        if (_services is not null)
        {
            return _services;
        }

        var result = await _device.GetGattServicesAsync(BluetoothCacheMode.Uncached);
        EnsureSuccess(result.Status, "enumerate GATT services");
        _services = result.Services.ToArray();
        return _services;
    }

    private static Guid ParseUuid(string uuidText)
    {
        return Guid.Parse(uuidText);
    }

    private static void EnsureSuccess(GattCommunicationStatus status, string operation)
    {
        if (status != GattCommunicationStatus.Success)
        {
            throw new InvalidOperationException($"Failed to {operation}: {status}.");
        }
    }

    private static byte[] ReadBytes(IBuffer buffer)
    {
        var data = new byte[buffer.Length];
        DataReader.FromBuffer(buffer).ReadBytes(data);
        return data;
    }
}

internal sealed record HelperRequest(string? Id, string Command, JsonElement? Arguments);

internal sealed record HelperEvent(string Name, object Payload);

internal sealed record NotificationEvent(string SessionId, string Uuid, string DataBase64);

internal sealed record ScanDevice(string Address, string Name, short Rssi);

internal static class JsonElementExtensions
{
    public static JsonElement? GetPropertyOrDefault(this JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) ? value : null;
    }

    public static JsonElement? GetPropertyOrDefaultNullable(this JsonElement? element, string propertyName)
    {
        return element is null ? null : element.Value.GetPropertyOrDefault(propertyName);
    }

    public static string RequireString(this JsonElement? element, string propertyName)
    {
        if (element is null)
        {
            throw new InvalidOperationException($"Missing arguments object. Expected '{propertyName}'.");
        }

        var property = element.Value.GetPropertyOrDefault(propertyName);
        if (property is null || property.Value.ValueKind != JsonValueKind.String)
        {
            throw new InvalidOperationException($"Missing string argument '{propertyName}'.");
        }

        return property.Value.GetString() ?? throw new InvalidOperationException($"Argument '{propertyName}' was empty.");
    }
}
