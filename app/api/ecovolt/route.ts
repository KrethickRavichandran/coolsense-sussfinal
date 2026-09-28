const API_BASE = "https://api.ecovolt.ai";
const SYSTEM_ID = "6a4874b0f5639589a65bb3b1";
const OFFICE_ROOM_ID = "6a4875a7d24f2c558726dfb5";
const S15_ID = "6a47aa69c41fa4fe8de91d95";
const PLUGS_ID = "6a47a16ebbc25de2f9c5dd1c";
const FCU_IDS = [
  "6a47acac5dc7e24b34d7c0a1",
  "6a47ad33103e910441b16cb7",
  "6a47ac5a5dc7e24b34d7c069",
];

type HistoryRow = {
  date: string;
  totalEnergyUsage: number;
  cost?: number;
};

type LiveDevice = {
  _id: string;
  deviceName: string;
  onStatus?: string;
  realTimePower?: number;
  realTimeVoltage?: number;
  totalEnergyUsage?: number;
  lastSeen?: string;
};

type EnvironmentSensor = {
  _id: string;
  deviceName: string;
  roomId?: string;
  temperature?: number;
  realTimeHumidity?: number;
  realTimeCarbonDioxide?: number;
  realTimeMotionDetected?: boolean;
  lastSeen?: string;
};

async function apiGet<T>(path: string, key: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "x-api-key": key },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SUSS API returned ${response.status}`);
  return response.json() as Promise<T>;
}

function rangePath(path: string, from: Date, till: Date) {
  const params = new URLSearchParams({ from: from.toISOString(), till: till.toISOString() });
  return `${path}?${params.toString()}`;
}

function compactHistory(rows: HistoryRow[]) {
  return rows.map((row) => ({
    date: row.date,
    energyKwh: Number(row.totalEnergyUsage.toFixed(3)),
    costSgd: typeof row.cost === "number" ? Number(row.cost.toFixed(2)) : null,
  }));
}

function sumHistory(rows: HistoryRow[]) {
  return Number(rows.reduce((sum, row) => sum + row.totalEnergyUsage, 0).toFixed(2));
}

function deviceSnapshot(device: LiveDevice | undefined) {
  return {
    powerW: Number((device?.realTimePower ?? 0).toFixed(2)),
    voltageV: Number((device?.realTimeVoltage ?? 0).toFixed(1)),
    status: device?.onStatus ?? "UNKNOWN",
    lastSeen: device?.lastSeen ?? null,
  };
}

export async function GET() {
  const key = process.env.ECOVOLT_API_KEY;
  if (!key) {
    return Response.json({ source: "unconfigured", message: "Live SUSS feed is not configured." }, { status: 503 });
  }

  const till = new Date();
  const from = new Date(till.getTime() - 14 * 86_400_000);

  try {
    const [directory, systemHistory, roomHistory, s15History, plugsHistory, mcbResponse, sensorResponse] = await Promise.all([
      apiGet<{ devices: unknown[]; rooms: unknown[]; distributionBoxes: unknown[] }>(`/api/system/${SYSTEM_ID}/sandbox-directory`, key),
      apiGet<HistoryRow[]>(rangePath(`/api/usage-history/date-range/system/${SYSTEM_ID}`, from, till), key),
      apiGet<HistoryRow[]>(rangePath(`/api/usage-history/date-range/room/${OFFICE_ROOM_ID}`, from, till), key),
      apiGet<HistoryRow[]>(rangePath(`/api/usage-history/date-range/device/${S15_ID}`, from, till), key),
      apiGet<HistoryRow[]>(rangePath(`/api/usage-history/date-range/device/${PLUGS_ID}`, from, till), key),
      apiGet<{ data: LiveDevice[]; total: number }>(`/api/mcb/system/${SYSTEM_ID}`, key),
      apiGet<{ data: EnvironmentSensor[]; total: number }>(`/api/environment-sensor/system/${SYSTEM_ID}`, key),
    ]);

    const mcbs = mcbResponse.data ?? [];
    const sensors = sensorResponse.data ?? [];
    const s15 = mcbs.find((device) => device._id === S15_ID);
    const plugs = mcbs.find((device) => device._id === PLUGS_ID);
    const fcuDevices = mcbs.filter((device) => FCU_IDS.includes(device._id));
    const officeSensors = sensors.filter((sensor) => sensor.roomId === OFFICE_ROOM_ID);
    const temperature = officeSensors.length
      ? officeSensors.reduce((sum, sensor) => sum + (sensor.temperature ?? 0), 0) / officeSensors.length
      : null;
    const humidity = officeSensors.length
      ? officeSensors.reduce((sum, sensor) => sum + (sensor.realTimeHumidity ?? 0), 0) / officeSensors.length
      : null;
    const co2Values = officeSensors.map((sensor) => sensor.realTimeCarbonDioxide).filter((value): value is number => typeof value === "number");
    const newestSeen = [...mcbs, ...sensors].map((device) => device.lastSeen).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

    return Response.json({
      source: "live",
      fetchedAt: new Date().toISOString(),
      system: {
        name: "SUSS",
        site: "SIM Block C · Level 6",
        deviceCount: directory.devices.length,
        roomCount: directory.rooms.length,
        distributionBoxCount: directory.distributionBoxes.length,
        mcbCount: mcbResponse.total,
        sensorCount: sensorResponse.total,
      },
      live: {
        totalPowerW: Number(mcbs.reduce((sum, device) => sum + (device.realTimePower ?? 0), 0).toFixed(2)),
        temperatureC: temperature === null ? null : Number(temperature.toFixed(1)),
        humidityPct: humidity === null ? null : Number(humidity.toFixed(1)),
        co2Ppm: co2Values.length ? Math.round(co2Values.reduce((sum, value) => sum + value, 0) / co2Values.length) : null,
        motionDetected: officeSensors.some((sensor) => sensor.realTimeMotionDetected),
        lastSeen: newestSeen,
        circuits: {
          s15: deviceSnapshot(s15),
          plugs: deviceSnapshot(plugs),
          fcu: {
            powerW: Number(fcuDevices.reduce((sum, device) => sum + (device.realTimePower ?? 0), 0).toFixed(2)),
            status: fcuDevices.some((device) => device.onStatus === "ON") ? "ON" : "OFF",
            devices: fcuDevices.length,
            lastSeen: fcuDevices.map((device) => device.lastSeen).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
          },
        },
      },
      history: {
        system: compactHistory(systemHistory),
        office: compactHistory(roomHistory),
        s15: compactHistory(s15History),
        plugs: compactHistory(plugsHistory),
        totals: {
          systemKwh: sumHistory(systemHistory),
          officeKwh: sumHistory(roomHistory),
          s15Kwh: sumHistory(s15History),
          plugsKwh: sumHistory(plugsHistory),
        },
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({
      source: "unavailable",
      message: error instanceof Error ? error.message : "Live SUSS feed is unavailable.",
    }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
