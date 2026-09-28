"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, AirVent, ArrowRight, BrainCircuit, Check, CheckCircle2, ChevronRight,
  CircleDollarSign, Clock3, Cpu, Download, Fan, Gauge, Layers3, Leaf, Lightbulb,
  Menu, Pause, Play, PlugZap, Radio, ShieldCheck, Sun, Target, Thermometer,
  TimerReset, TrendingDown, Users, Waves, X, Zap,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SourceKind = "MEASURED" | "OBSERVED" | "MODELLED";
type InterventionId = "schedule" | "fans" | "solar" | "lighting" | "plugs" | "damper";
type ApiState = "loading" | "live" | "fallback";

type LiveHistoryRow = {
  date: string;
  energyKwh: number;
  costSgd: number | null;
};

type LiveCircuit = {
  powerW: number;
  voltageV?: number;
  status: string;
  lastSeen: string | null;
};

type SussApiData = {
  source: "live";
  fetchedAt: string;
  system: {
    name: string;
    site: string;
    deviceCount: number;
    roomCount: number;
    distributionBoxCount: number;
    mcbCount: number;
    sensorCount: number;
  };
  live: {
    totalPowerW: number;
    temperatureC: number | null;
    humidityPct: number | null;
    co2Ppm: number | null;
    motionDetected: boolean;
    lastSeen: string | null;
    circuits: {
      s15: LiveCircuit;
      plugs: LiveCircuit;
      fcu: LiveCircuit & { devices: number };
    };
  };
  history: {
    system: LiveHistoryRow[];
    office: LiveHistoryRow[];
    s15: LiveHistoryRow[];
    plugs: LiveHistoryRow[];
    totals: { systemKwh: number; officeKwh: number; s15Kwh: number; plugsKwh: number };
  };
};

type TwinAsset = {
  id: string;
  name: string;
  circuit: string;
  reading: string;
  source: SourceKind;
  problem: string;
  action: string;
  safeguard: string;
  accent: "green" | "cyan" | "amber" | "rose";
};

const BASELINE_KWH = 27.47;
const WORK_DAYS = 260;

const hourlyData = [
  { time: "00", ac: 0.12, plugs: 0.10, lights: 0 },
  { time: "02", ac: 0.12, plugs: 0.10, lights: 0 },
  { time: "04", ac: 1.18, plugs: 0.10, lights: 0 },
  { time: "06", ac: 1.24, plugs: 0.11, lights: 0 },
  { time: "08", ac: 1.28, plugs: 0.28, lights: 0.29 },
  { time: "10", ac: 1.25, plugs: 0.34, lights: 0.29 },
  { time: "12", ac: 1.22, plugs: 0.31, lights: 0.28 },
  { time: "14", ac: 1.20, plugs: 0.35, lights: 0.29 },
  { time: "16", ac: 1.18, plugs: 0.33, lights: 0.28 },
  { time: "18", ac: 1.14, plugs: 0.29, lights: 0.26 },
  { time: "20", ac: 0.14, plugs: 0.28, lights: 0 },
  { time: "22", ac: 0.12, plugs: 0.11, lights: 0 },
];

const categoryData = [
  { name: "Air-conditioning", value: 18.0, color: "#5df2ba" },
  { name: "Plug loads", value: 6.1, color: "#52c7ff" },
  { name: "Lighting", value: 3.37, color: "#ffd36a" },
];

const assets: TwinAsset[] = [
  {
    id: "fcu", name: "Chilled-water FCU branch", circuit: "Central AC branch · Level 6",
    reading: "746 W avg · 1,296 W peak", source: "MEASURED",
    problem: "The sample FCU starts near 04:00 although normal occupancy begins at 08:30.",
    action: "Recommission start/stop first; add adaptive start based on room temperature and first-arrival patterns.",
    safeguard: "Maintain minimum ventilation and give facilities a manual override.", accent: "green",
  },
  {
    id: "meeting", name: "Shared meeting-room branch", circuit: "Shared thermostat / supply duct",
    reading: "0 / 13 occupied · 23.9°C observed", source: "OBSERVED",
    problem: "A vacant room feels strongly cooled because a shared control zone cannot see local demand.",
    action: "Field-check duct sharing. Only then add a room sensor and modulating damper if measured waste justifies it.",
    safeguard: "Do not add a competing thermostat; coordinate damper position with fan speed and chilled-water valve.", accent: "rose",
  },
  {
    id: "solar", name: "Perimeter glazing", circuit: "Window heat-load pathway",
    reading: "Solar area is a field input", source: "MODELLED",
    problem: "Solar radiation raises perimeter heat load and can make the control system call for extra cooling.",
    action: "Trial selective film or operable blinds on the hottest facade before increasing AC capacity.",
    safeguard: "Measure glare, visible-light transmission and before/after surface temperature.", accent: "amber",
  },
  {
    id: "lighting", name: "Working-pod lighting", circuit: "Circuit S15 · 12 × 25 W panels",
    reading: "293 W peak vs 300 W design", source: "MEASURED",
    problem: "The LEDs are already efficient, but the profile runs roughly 07:30–19:00 against 08:30–17:30 operations.",
    action: "Keep the fittings. Trim the timer and add occupancy/daylight control only where persistence is verified.",
    safeguard: "Retain manual-on control and minimum task-lighting levels.", accent: "amber",
  },
  {
    id: "plugs", name: "Working-pod socket groups", circuit: "P21–P27 · SSO groups",
    reading: "258 W avg · ~95 W baseload", source: "MEASURED",
    problem: "A persistent overnight load suggests monitors, chargers or shared equipment remain energised.",
    action: "Inventory devices, whitelist essential loads, then control only verified non-critical sockets after hours.",
    safeguard: "Never switch network, life-safety, refrigeration or user-critical equipment.", accent: "cyan",
  },
  {
    id: "fans", name: "Existing bladeless fans", circuit: "Comfort support layer",
    reading: "Present on the lighting plan", source: "OBSERVED",
    problem: "Cooling setpoint alone ignores the comfort benefit of air movement.",
    action: "Use the existing fans to support a gradual 26°C setpoint trial, subject to occupant-level air-speed checks.",
    safeguard: "Validate with PMV/PPD screening and a short occupant survey.", accent: "cyan",
  },
];

const interventions: Array<{ id: InterventionId; title: string; subtitle: string; source: SourceKind; icon: typeof AirVent }> = [
  { id: "schedule", title: "Adaptive FCU schedule", subtitle: "Cut verified pre-cooling and overrun", source: "MEASURED", icon: TimerReset },
  { id: "fans", title: "Fan-assisted comfort", subtitle: "Raise setpoint only while comfort holds", source: "MODELLED", icon: Fan },
  { id: "solar", title: "Targeted solar control", subtitle: "Block heat before paying to remove it", source: "MODELLED", icon: Sun },
  { id: "lighting", title: "S15 timer + occupancy", subtitle: "Control the LEDs; do not replace them", source: "MEASURED", icon: Lightbulb },
  { id: "plugs", title: "Managed P21–P27 sockets", subtitle: "Remove only verified non-critical baseload", source: "MEASURED", icon: PlugZap },
  { id: "damper", title: "Room-level damper", subtitle: "Stage 2 only after duct field-check", source: "MODELLED", icon: AirVent },
];

const pilotPhases = [
  { day: "DAYS 1–14", title: "Instrument", body: "Map S15, P21–P27 and the FCU branch. Log occupancy, temperature, CO₂ and weather. Freeze the baseline." },
  { day: "DAYS 15–30", title: "No-regret controls", body: "Trim timers, create plug whitelists and trial existing fans. No permanent mechanical work yet." },
  { day: "DAYS 31–60", title: "Targeted retrofit", body: "Add solar film or a damper only where submeter and comfort evidence clears the investment gate." },
  { day: "DAYS 61–90", title: "Verify + scale", body: "Compare matched weekdays. Approve rollout only if energy, comfort and operational gates all pass." },
];

const demoMoments = [
  { time: "04:00", label: "Empty office", occupants: 0, asset: "fcu", decision: "Hold FCU at setback; no fixed pre-cooling." },
  { time: "08:30", label: "First arrivals", occupants: 9, asset: "fcu", decision: "Start only the required branch and verify comfort." },
  { time: "14:00", label: "Solar peak", occupants: 31, asset: "solar", decision: "Block heat at the glass; fans preserve comfort." },
  { time: "18:00", label: "Office closes", occupants: 0, asset: "plugs", decision: "End cooling; remove whitelisted plug baseload." },
];

function SourceTag({ kind }: { kind: SourceKind }) {
  return <span className={`source-tag source-${kind.toLowerCase()}`}>{kind}</span>;
}

function ApiTag({ state }: { state: ApiState }) {
  const label = state === "live" ? "LIVE SUSS API" : state === "loading" ? "CONNECTING" : "MODEL FALLBACK";
  return <span className={`api-tag api-${state}`}><i />{label}</span>;
}

function PanelHeading({ index, title, note }: { index: string; title: string; note?: string }) {
  return <div className="panel-heading"><div><span className="section-index">{index}</span><h2>{title}</h2></div>{note ? <small>{note}</small> : null}</div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><small>{label}:00</small>{payload.map((item) => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><b>{item.value.toFixed(2)} kW</b></div>)}</div>;
}

function LiveChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip live-tooltip"><small>{label}</small><div><i style={{ background: "#5df2ba" }} /><span>Office energy</span><b>{payload[0].value.toFixed(2)} kWh</b></div></div>;
}

function formatPower(powerW: number) {
  return powerW >= 1000 ? `${(powerW / 1000).toFixed(2)} kW` : `${Math.round(powerW)} W`;
}

function calculatePmv(temp: number, speed: number, humidity: number, met = 1, clo = 0.61) {
  const ta = temp, tr = temp;
  const pa = humidity * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));
  const icl = 0.155 * clo, m = met * 58.15, mw = m;
  const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
  const hcf = 12.1 * Math.sqrt(speed), taa = ta + 273, tra = tr + 273;
  const tcla = taa + (35.5 - ta) / (3.5 * (6.45 * icl + 0.1));
  const p1 = icl * fcl, p2 = p1 * 3.96, p3 = p1 * 100, p4 = p1 * taa;
  const p5 = 308.7 - 0.028 * mw + p2 * Math.pow(tra / 100, 4);
  let xn = tcla / 100, xf = xn * 2, hc = hcf, iterations = 0;
  while (Math.abs(xn - xf) > 0.00015 && iterations < 150) {
    xf = (xf + xn) / 2;
    const hcn = 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25);
    hc = Math.max(hcf, hcn);
    xn = (p5 + p4 * hc - p2 * Math.pow(xn, 4)) / (100 + p3 * hc);
    iterations += 1;
  }
  const tcl = 100 * xn - 273;
  const hl1 = 0.00305 * (5733 - 6.99 * mw - pa);
  const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
  const hl3 = 1.7e-5 * m * (5867 - pa), hl4 = 0.0014 * m * (34 - ta);
  const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
  const hl6 = fcl * hc * (tcl - ta), ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
  const pmv = ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
  const ppd = 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * Math.pow(pmv, 2));
  return { pmv, ppd };
}

function calculateScenario(
  enabled: Record<InterventionId, boolean>,
  values: { startTrim: number; endTrim: number; setpoint: number; airSpeed: number; solarArea: number; lightingTrim: number; plugHours: number; tariff: number; scale: number },
) {
  const schedule = enabled.schedule ? 1.15 * (values.startTrim + values.endTrim) : 0;
  const fans = enabled.fans ? Math.max(0, 10.35 * 0.08 * (values.setpoint - 25) - 0.30) : 0;
  const solar = enabled.solar ? values.solarArea * 0.35 * 0.25 * 4 / 3.5 : 0;
  const damper = enabled.damper ? 0.70 : 0, hvacFactor = 0.80;
  const lighting = enabled.lighting ? 0.293 * values.lightingTrim : 0;
  const plugs = enabled.plugs ? 0.095 * values.plugHours : 0;
  const rows = [
    { id: "schedule", label: "Adaptive schedule", kwh: schedule * hvacFactor, capex: enabled.schedule ? 250 : 0, color: "#5df2ba" },
    { id: "fans", label: "Fan + setpoint", kwh: fans * hvacFactor, capex: enabled.fans ? 200 : 0, color: "#52c7ff" },
    { id: "solar", label: "Solar control", kwh: solar * hvacFactor, capex: enabled.solar ? values.solarArea * 55 : 0, color: "#ffd36a" },
    { id: "lighting", label: "S15 controls", kwh: lighting, capex: enabled.lighting ? 450 : 0, color: "#a78bfa" },
    { id: "plugs", label: "Managed sockets", kwh: plugs, capex: enabled.plugs ? 360 : 0, color: "#52c7ff" },
    { id: "damper", label: "Modulating damper", kwh: damper * hvacFactor, capex: enabled.damper ? 1600 : 0, color: "#ff7792" },
  ];
  const daily = Math.min(BASELINE_KWH * 0.45, rows.reduce((sum, row) => sum + row.kwh, 0));
  const annualKwh = daily * WORK_DAYS * values.scale, annualCost = annualKwh * values.tariff;
  const capex = rows.reduce((sum, row) => sum + row.capex, 0) * values.scale;
  return { rows, daily, annualKwh, annualCost, capex, payback: annualCost > 0 ? capex / annualCost : 0, carbon: annualKwh * 0.4 / 1000, percent: daily / BASELINE_KWH * 100 };
}

function CircuitTwin({ selected, onSelect, live }: { selected: string; onSelect: (id: string) => void; live?: SussApiData["live"] }) {
  const active = assets.find((asset) => asset.id === selected) ?? assets[0];
  const liveReading = selected === "fcu" && live
    ? `${formatPower(live.circuits.fcu.powerW)} · ${live.circuits.fcu.devices} mapped circuits`
    : selected === "lighting" && live
      ? `${formatPower(live.circuits.s15.powerW)} · ${live.circuits.s15.status}`
      : selected === "plugs" && live
        ? `${formatPower(live.circuits.plugs.powerW)} · ${live.circuits.plugs.status}`
        : selected === "meeting" && live?.temperatureC !== null && live?.temperatureC !== undefined
          ? `${live.temperatureC.toFixed(1)}°C · ${live.humidityPct?.toFixed(0) ?? "—"}% RH`
          : null;
  return <div className="twin-grid">
    <div className="floor-card">
      <div className="floor-toolbar"><div><span className="live-dot" /> LEVEL 6 · CIRCUIT OVERLAY</div><span>CLICK AN ASSET</span></div>
      <div className="floor-plan">
        <button className={`asset asset-fcu ${selected === "fcu" ? "active" : ""}`} onClick={() => onSelect("fcu")}><AirVent /><b>FCU BRANCH</b><small>{live ? `${formatPower(live.circuits.fcu.powerW)} LIVE` : "746 W AVG"}</small></button>
        <button className={`asset asset-solar ${selected === "solar" ? "active" : ""}`} onClick={() => onSelect("solar")}><Sun /><b>PERIMETER GLASS</b><small>SOLAR LOAD</small></button>
        <button className={`asset asset-meeting ${selected === "meeting" ? "active" : ""}`} onClick={() => onSelect("meeting")}><Users /><b>6A OFFICE</b><small>{live?.temperatureC !== null && live?.temperatureC !== undefined ? `${live.temperatureC.toFixed(1)}°C LIVE` : "0 / 13"}</small></button>
        <button className={`asset asset-lighting ${selected === "lighting" ? "active" : ""}`} onClick={() => onSelect("lighting")}><Lightbulb /><b>S15 LIGHTING</b><small>{live ? `${formatPower(live.circuits.s15.powerW)} LIVE` : "12 × 25 W"}</small></button>
        <button className={`asset asset-plugs ${selected === "plugs" ? "active" : ""}`} onClick={() => onSelect("plugs")}><PlugZap /><b>P21–P27</b><small>{live ? `${formatPower(live.circuits.plugs.powerW)} LIVE` : "SOCKET GROUPS"}</small></button>
        <button className={`asset asset-fans ${selected === "fans" ? "active" : ""}`} onClick={() => onSelect("fans")}><Fan /><b>EXISTING FANS</b><small>COMFORT LAYER</small></button>
        <div className="floor-corridor"><span>LIFT LOBBY</span><i /><i /><i /></div>
        <div className="airflow airflow-a" /><div className="airflow airflow-b" /><div className="airflow airflow-c" />
      </div>
      <div className="circuit-rail"><span>POWER / CHW</span><i /><i /><i /><i /><strong>ZONE DEMAND</strong></div>
    </div>
    <aside className={`asset-inspector inspector-${active.accent}`}>
      <div className="inspector-top"><SourceTag kind={active.source} /><span>ASSET {String(assets.indexOf(active) + 1).padStart(2, "0")}</span></div>
      <h3>{active.name}</h3><p className="asset-circuit">{active.circuit}</p>
      <div className={`asset-reading ${liveReading ? "asset-reading-live" : ""}`}><Activity /><div><span>{liveReading ? "LIVE SUSS API" : "Evidence"}</span><strong>{liveReading ?? active.reading}</strong></div></div>
      <div className="inspector-block"><span>ROOT CAUSE</span><p>{active.problem}</p></div>
      <div className="inspector-block action"><span>LOWEST-COST ACTION</span><p>{active.action}</p></div>
      <div className="safeguard"><ShieldCheck /><p><b>Guardrail</b>{active.safeguard}</p></div>
    </aside>
  </div>;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedAsset, setSelectedAsset] = useState("fcu");
  const [pitchOpen, setPitchOpen] = useState(false);
  const [pitchStep, setPitchStep] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [occupants, setOccupants] = useState(0);
  const [humidity, setHumidity] = useState(50);
  const [apiData, setApiData] = useState<SussApiData | null>(null);
  const [apiState, setApiState] = useState<ApiState>("loading");
  const [profileMode, setProfileMode] = useState<"live" | "sample">("live");
  const [enabled, setEnabled] = useState<Record<InterventionId, boolean>>({ schedule: true, fans: true, solar: true, lighting: true, plugs: true, damper: false });
  const [values, setValues] = useState({ startTrim: 3.5, endTrim: 1, setpoint: 26, airSpeed: 0.35, solarArea: 16, lightingTrim: 2.5, plugHours: 12, tariff: 0.30, scale: 1 });
  const scenario = useMemo(() => calculateScenario(enabled, values), [enabled, values]);
  const comfort = useMemo(() => calculatePmv(values.setpoint, enabled.fans ? values.airSpeed : 0.1, humidity), [values.setpoint, values.airSpeed, humidity, enabled.fans]);
  const comfortOk = Math.abs(comfort.pmv) <= 0.5 && comfort.ppd <= 10;
  const liveProfile = useMemo(() => apiData?.history.office.map((row) => ({
    ...row,
    label: new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "short", timeZone: "Asia/Singapore" }).format(new Date(row.date)),
  })) ?? [], [apiData]);
  const lastUpdated = apiData ? new Intl.DateTimeFormat("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" }).format(new Date(apiData.fetchedAt)) : null;

  useEffect(() => {
    let mounted = true;
    const loadLiveData = async () => {
      try {
        const response = await fetch("/api/ecovolt", { cache: "no-store" });
        if (!response.ok) throw new Error("Live feed unavailable");
        const data = await response.json() as SussApiData;
        if (!mounted || data.source !== "live") return;
        setApiData(data);
        setApiState("live");
        if (data.live.humidityPct !== null) setHumidity(Math.round(data.live.humidityPct));
      } catch {
        if (mounted) setApiState("fallback");
      }
    };
    void loadLiveData();
    const timer = window.setInterval(() => void loadLiveData(), 60_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!demoRunning) return;
    const timer = window.setInterval(() => setDemoStep((step) => {
      const next = (step + 1) % demoMoments.length;
      setOccupants(demoMoments[next].occupants); setSelectedAsset(demoMoments[next].asset); return next;
    }), 2200);
    return () => window.clearInterval(timer);
  }, [demoRunning]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPitchOpen(false);
      if (!pitchOpen) return;
      if (event.key === "ArrowRight") setPitchStep((step) => Math.min(4, step + 1));
      if (event.key === "ArrowLeft") setPitchStep((step) => Math.max(0, step - 1));
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [pitchOpen]);

  useEffect(() => {
    type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
    type ModelContext = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as unknown as { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "configure_coolsense_pilot", title: "Configure the CoolSense pilot",
      description: "Set pilot occupancy, comfort target, air speed, solar-control area and rollout scale.",
      inputSchema: { type: "object", properties: { occupants: { type: "number", minimum: 0, maximum: 80 }, setpoint: { type: "number", minimum: 25, maximum: 27 }, airSpeed: { type: "number", minimum: 0.1, maximum: 0.8 }, solarArea: { type: "number", minimum: 0, maximum: 60 }, scale: { type: "number", minimum: 1, maximum: 8 } }, required: ["occupants", "setpoint", "airSpeed", "solarArea", "scale"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const next = input as Record<string, number>;
        if (![next.occupants, next.setpoint, next.airSpeed, next.solarArea, next.scale].every(Number.isFinite)) throw new Error("All pilot inputs must be numbers.");
        setOccupants(Math.max(0, Math.min(80, next.occupants)));
        setValues((current) => ({ ...current, setpoint: Math.max(25, Math.min(27, next.setpoint)), airSpeed: Math.max(0.1, Math.min(0.8, next.airSpeed)), solarArea: Math.max(0, Math.min(60, next.solarArea)), scale: Math.max(1, Math.min(8, Math.round(next.scale))) }));
        return { status: "configured", note: "Planning estimates pending a metered pilot." };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const toggle = (id: InterventionId) => setEnabled((current) => ({ ...current, [id]: !current[id] }));
  const setValue = (key: keyof typeof values, value: number) => setValues((current) => ({ ...current, [key]: value }));
  const nav = [
    { value: "overview", label: "Command centre", icon: Gauge },
    { value: "twin", label: "Circuit twin", icon: Layers3 },
    { value: "optimizer", label: "Pilot optimizer", icon: BrainCircuit },
    { value: "economics", label: "Business case", icon: CircleDollarSign },
    { value: "deployment", label: "90-day rollout", icon: Target },
  ];
  const pitchSlides = [
    <div className="pitch-slide" key="problem"><span className="pitch-kicker">01 · THE MISMATCH</span><h2>We are cooling a schedule.<br /><em>Not the people.</em></h2><div className="pitch-numbers"><div><b>04:00</b><span>sample FCU starts</span></div><div><b>08:30</b><span>office operations start</span></div><div><b>39%</b><span>observed seat use</span></div></div></div>,
    <div className="pitch-slide" key="evidence"><span className="pitch-kicker">02 · THE EVIDENCE</span><h2>Three measured circuits.<br /><em>Three fixable leaks.</em></h2><div className="pitch-proof"><div><AirVent /><b>FCU</b><span>746 W average</span></div><div><Lightbulb /><b>S15</b><span>2.5 h excess window</span></div><div><PlugZap /><b>P21–P27</b><span>~95 W baseload</span></div></div></div>,
    <div className="pitch-slide" key="solution"><span className="pitch-kicker">03 · THE SOLUTION</span><h2>CoolSense Circuit Twin</h2><p>One evidence layer connects each circuit to occupancy, comfort and the lowest-cost physical intervention.</p><div className="pitch-flow"><span>SENSE</span><ChevronRight /><span>DIAGNOSE</span><ChevronRight /><span>CONTROL</span><ChevronRight /><span>VERIFY</span></div></div>,
    <div className="pitch-slide" key="business"><span className="pitch-kicker">04 · THE CASE</span><h2><em>{scenario.percent.toFixed(0)}%</em> modelled pilot reduction</h2><div className="pitch-numbers"><div><b>{scenario.daily.toFixed(1)}</b><span>kWh / weekday</span></div><div><b>S${Math.round(scenario.annualCost).toLocaleString()}</b><span>annual avoided cost</span></div><div><b>{scenario.payback.toFixed(1)} yr</b><span>simple payback</span></div></div><small>Current slider assumptions · conservative 20% HVAC interaction derating</small></div>,
    <div className="pitch-slide" key="ask"><span className="pitch-kicker">05 · THE ASK</span><h2>Approve one 90-day<br /><em>Level 6 pilot.</em></h2><p>Success gate: ≥15% weather-matched energy reduction, PPD ≤10%, no increase in comfort complaints, and facilities sign-off.</p><div className="pitch-ask"><CheckCircle2 /><span>Low-regret controls first. Mechanical retrofit only after evidence.</span></div></div>,
  ];

  return <main>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand"><span className="brand-icon"><Waves /></span><div><strong>COOL<span>SENSE</span></strong><small>CIRCUIT TWIN · SUSS</small></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X /></button></div>
        <div className={`site-status site-status-${apiState}`}><span className="live-dot" /><div><b>{apiState === "live" ? "LIVE SUSS FEED" : apiState === "loading" ? "CONNECTING TO SUSS" : "PILOT MODEL ONLINE"}</b><small>{apiState === "live" ? `${apiData?.system.deviceCount ?? 0} devices · ${lastUpdated ?? "updating"}` : "Level 6 · Blk C"}</small></div></div>
        <nav aria-label="Application sections">{nav.map(({ value, label, icon: Icon }, index) => <button key={value} className={activeTab === value ? "active" : ""} onClick={() => { setActiveTab(value); setMobileNav(false); }}><span>{String(index + 1).padStart(2, "0")}</span><Icon /><b>{label}</b><ChevronRight /></button>)}</nav>
        <div className="sidebar-foot"><div><Leaf /><span>PLANET<br />RESILIENCE</span></div><p>Every claim is marked measured, observed or modelled.</p></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu /></button><div className="top-title"><span>UOB–SUSS INNOVATION FOR SUSTAINABLE IMPACT</span><h1>{nav.find((item) => item.value === activeTab)?.label}</h1></div><div className="top-actions"><button className="print-button" onClick={() => window.print()}><Download /> REPORT</button><Button onClick={() => { setPitchStep(0); setPitchOpen(true); }} className="pitch-button"><Play />90-SEC PITCH</Button></div></header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="main-tabs">
          <TabsList className="mobile-tabs" aria-label="Dashboard views">{nav.map((item) => <TabsTrigger value={item.value} key={item.value}>{item.label}</TabsTrigger>)}</TabsList>

          <TabsContent value="overview" className="tab-content">
            <section className="hero-grid">
              <article className="hero-panel"><div className="hero-copy"><div className="hero-meta"><ApiTag state={apiState} /><span>{apiState === "live" ? "SIM BLOCK C · LEVEL 6 · AUTO-REFRESH 60s" : "AUG 2026 DATA · 188 m² PILOT"}</span></div><h2>Turn every wasted watt into a <em>physical action.</em></h2><p>CoolSense maps the S15 lighting circuit, P21–P27 sockets, chilled-water FCU branch and window heat load to occupancy and comfort—then ranks the cheapest intervention that facilities can actually implement.</p><div className="hero-actions"><Button onClick={() => setActiveTab("twin")} className="primary-cta">EXPLORE THE CIRCUIT TWIN <ArrowRight /></Button><button onClick={() => setActiveTab("optimizer")} className="text-cta">Test assumptions <ChevronRight /></button></div></div><div className="hero-visual"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="core"><BrainCircuit /><span>COOLSENSE</span><b>DECISION<br />ENGINE</b></div>{["FCU", "S15", "P21–27", "GLASS"].map((label, index) => <div key={label} className={`node node-${index + 1}`}><i />{label}</div>)}</div></article>
              <article className="decision-panel"><div className="decision-head"><span><Radio /> LIVE DECISION TRACE</span><button onClick={() => setDemoRunning((run) => !run)}>{demoRunning ? <Pause /> : <Play />}{demoRunning ? "PAUSE" : "RUN DEMO"}</button></div><div className="decision-time"><b>{demoMoments[demoStep].time}</b><span>{demoMoments[demoStep].label}</span></div><div className="decision-signal"><div><Users /><span>OCCUPANCY</span><b>{occupants} / 80</b></div><ArrowRight /><div><Cpu /><span>DECISION</span><b>{demoMoments[demoStep].decision}</b></div></div><div className="demo-dots">{demoMoments.map((item, index) => <button aria-label={`Show ${item.time}`} key={item.time} className={index === demoStep ? "active" : ""} onClick={() => { setDemoStep(index); setOccupants(item.occupants); setSelectedAsset(item.asset); }} />)}</div></article>
            </section>

            <section className="metric-grid">
              <article><span><Zap /> {apiData ? "14-DAY OFFICE ENERGY" : "MONITORED SAMPLE"}</span><b>{apiData ? apiData.history.totals.officeKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "27.47"} <small>{apiData ? "kWh" : "kWh/day"}</small></b><p>{apiData ? "Live 6A Office usage history" : "Three reconstructed component profiles"}</p>{apiData ? <ApiTag state="live" /> : <SourceTag kind="MEASURED" />}</article>
              <article><span><AirVent /> {apiData ? "LIVE FCU-L6-16 DRAW" : "LARGEST LOAD"}</span><b>{apiData ? formatPower(apiData.live.circuits.fcu.powerW).split(" ")[0] : "65.5"}<small>{apiData ? formatPower(apiData.live.circuits.fcu.powerW).split(" ")[1] : "% cooling"}</small></b><p>{apiData ? `${apiData.live.circuits.fcu.devices} mapped FCU circuits · ${apiData.live.circuits.fcu.status}` : "18.0 kWh in the sample profile"}</p>{apiData ? <ApiTag state="live" /> : <SourceTag kind="MEASURED" />}</article>
              <article><span><Thermometer /> {apiData ? "OFFICE ENVIRONMENT" : "SPACE USE"}</span><b>{apiData?.live.temperatureC !== null && apiData?.live.temperatureC !== undefined ? apiData.live.temperatureC.toFixed(1) : "31"}<small>{apiData ? "°C" : "/ 80 seats"}</small></b><p>{apiData ? `${apiData.live.humidityPct?.toFixed(0) ?? "—"}% RH · ${apiData.live.co2Ppm ? `${apiData.live.co2Ppm} ppm CO₂` : "CO₂ unavailable"}` : "30–40% filled during walkthrough"}</p>{apiData ? <ApiTag state="live" /> : <SourceTag kind="OBSERVED" />}</article>
              <article className="metric-highlight"><span><TrendingDown /> PILOT OPPORTUNITY</span><b>{scenario.percent.toFixed(0)}<small>% reduction</small></b><p>{scenario.daily.toFixed(1)} kWh per weekday under current settings</p><SourceTag kind="MODELLED" /></article>
            </section>

            {apiData ? <section className="live-source-strip"><div><Radio /><span><b>VERIFIED LIVE CONNECTION</b>SUSS electrical + environmental API</span></div><div><span>DEVICES</span><b>{apiData.system.deviceCount}</b></div><div><span>MCBs</span><b>{apiData.system.mcbCount}</b></div><div><span>SENSORS</span><b>{apiData.system.sensorCount}</b></div><div><span>LIVE SITE DRAW</span><b>{formatPower(apiData.live.totalPowerW)}</b></div><small>REFRESHED {lastUpdated} SGT</small></section> : null}

            <section className="overview-grid">
              <article className="panel profile-panel"><PanelHeading index="01" title={profileMode === "live" && apiData ? "6A Office energy — last 14 days" : "Energy is used outside the occupancy window"} note={profileMode === "live" && apiData ? "LIVE API HISTORY" : "SAMPLE WEEKDAY"} /><div className="chart-mode-toggle"><button className={profileMode === "live" ? "active" : ""} disabled={!apiData} onClick={() => setProfileMode("live")}>LIVE 14D</button><button className={profileMode === "sample" ? "active" : ""} onClick={() => setProfileMode("sample")}>SAMPLE DAY</button></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%">{profileMode === "live" && apiData ? <AreaChart data={liveProfile} margin={{ top: 15, right: 12, left: -17, bottom: 0 }}><defs><linearGradient id="liveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5df2ba" stopOpacity=".32" /><stop offset="1" stopColor="#5df2ba" stopOpacity="0" /></linearGradient></defs><CartesianGrid stroke="#19323a" vertical={false} strokeDasharray="3 6" /><XAxis dataKey="label" stroke="#526872" tickLine={false} axisLine={false} fontSize={9} interval="preserveStartEnd" /><YAxis stroke="#526872" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(v) => `${v}k`} /><Tooltip content={<LiveChartTooltip />} /><Area type="monotone" dataKey="energyKwh" name="Office energy" stroke="#5df2ba" fill="url(#liveFill)" strokeWidth={2.4} /></AreaChart> : <AreaChart data={hourlyData} margin={{ top: 15, right: 12, left: -22, bottom: 0 }}><defs><linearGradient id="acFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5df2ba" stopOpacity=".28" /><stop offset="1" stopColor="#5df2ba" stopOpacity="0" /></linearGradient></defs><CartesianGrid stroke="#19323a" vertical={false} strokeDasharray="3 6" /><ReferenceArea x1="04" x2="08" fill="#ff7792" fillOpacity={0.07} /><ReferenceLine x="08" stroke="#ffd36a" strokeDasharray="4 5" /><XAxis dataKey="time" stroke="#526872" tickLine={false} axisLine={false} fontSize={10} /><YAxis stroke="#526872" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(v) => `${v}k`} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="ac" name="Air-con" stroke="#5df2ba" fill="url(#acFill)" strokeWidth={2.4} /><Area type="monotone" dataKey="plugs" name="Plug loads" stroke="#52c7ff" fill="#52c7ff10" strokeWidth={1.7} /><Area type="monotone" dataKey="lights" name="Lighting" stroke="#ffd36a" fill="#ffd36a0d" strokeWidth={1.7} /></AreaChart>}</ResponsiveContainer></div><div className="chart-caption"><div>{profileMode === "live" && apiData ? <span><i className="legend-ac" />6A OFFICE kWh</span> : <><span><i className="legend-ac" />AIR-CON</span><span><i className="legend-plug" />PLUGS</span><span><i className="legend-light" />LIGHTS</span></>}</div><p>{profileMode === "live" && apiData ? <><b>LIVE</b> daily energy from the SUSS feed</> : <><b>RED BAND</b> cooling before normal operations</>}</p></div></article>
              <article className="panel priority-panel"><PanelHeading index="02" title="Intervention priority" note="BY ENERGY SHARE" /><div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" innerRadius={66} outerRadius={91} paddingAngle={4} stroke="none">{categoryData.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie></PieChart></ResponsiveContainer><div><b>27.47</b><span>kWh / day</span></div></div><div className="mix-list">{categoryData.map((item, index) => <div key={item.name}><span><i style={{ background: item.color }} />0{index + 1}</span><b>{item.name}</b><strong>{(item.value / BASELINE_KWH * 100).toFixed(1)}%</strong></div>)}</div><p className="priority-note"><Target /> Fix timing before hardware: the FCU schedule is the highest-confidence, lowest-capex move.</p></article>
            </section>
            <section className="proof-strip"><div><span>THE PROJECT</span><h3>CoolSense Circuit Twin</h3></div><p>Not another awareness dashboard. It is a commissioning and retrofit decision tool that tells facilities <b>what to change, where, why, how much it may save, and what safety condition must remain true.</b></p><button onClick={() => setActiveTab("twin")}>OPEN DIGITAL TWIN <ArrowRight /></button></section>
          </TabsContent>

          <TabsContent value="twin" className="tab-content">
            <section className="section-intro"><div><span>PHYSICAL + DIGITAL PROTOTYPE</span><h2>Trace the load. Find the cause.<br /><em>Change the right thing.</em></h2></div><p>The diagram is intentionally circuit-level: it connects the supplied electrical and air-conditioning drawings to one implementable Level 6 pilot.</p></section>
            <article className="panel twin-panel"><PanelHeading index="01" title="Interactive Level 6 pilot map" note={apiData ? "LIVE CIRCUIT VALUES" : "SELECT ANY ASSET"} /><CircuitTwin selected={selectedAsset} onSelect={setSelectedAsset} live={apiData?.live} /></article>
            <section className="trace-grid"><article className="panel trace-panel"><PanelHeading index="02" title="Evidence-to-action trace" note="AUDITABLE LOGIC" /><div className="trace-flow"><div><span>1</span><Activity /><b>SIGNAL</b><p>Read the circuit profile</p></div><ChevronRight /><div><span>2</span><Users /><b>CONTEXT</b><p>Match occupancy + hours</p></div><ChevronRight /><div><span>3</span><BrainCircuit /><b>ROOT CAUSE</b><p>Schedule, heat or control?</p></div><ChevronRight /><div><span>4</span><Target /><b>ACTION</b><p>Rank by cost and risk</p></div><ChevronRight /><div><span>5</span><ShieldCheck /><b>VERIFY</b><p>Meter + comfort gate</p></div></div></article><article className="panel luminaires"><PanelHeading index="03" title="Lighting reality check" note="DRAWING SCHEDULE" /><div className="luminaire-total"><Lightbulb /><div><b>6.163 kW</b><span>total installed lighting schedule</span></div></div><div className="luminaire-bars">{[{ label: "146 × 25 W", value: 3650 }, { label: "42 × 30 W", value: 1260 }, { label: "59 × 11.8 W", value: 696 }, { label: "Other", value: 557 }].map((row) => <div key={row.label}><span>{row.label}</span><i><em style={{ width: `${row.value / 3650 * 100}%` }} /></i><b>{row.value.toLocaleString()} W</b></div>)}</div><p><Check /> S15 measured 293 W against a 300 W design load. The fittings are not the problem; run-time is.</p></article></section>
          </TabsContent>

          <TabsContent value="optimizer" className="tab-content">
            <section className="section-intro"><div><span>ASSUMPTION-TRANSPARENT MODEL</span><h2>Build the pilot.<br /><em>Watch every number move.</em></h2></div><p>Toggle measures on and off. Savings are deliberately derated where HVAC effects interact, and all outputs remain planning estimates until measured.</p></section>
            <section className="optimizer-grid"><article className="panel intervention-panel"><PanelHeading index="01" title="Intervention stack" note="TOGGLE TO COMPARE" /><div className="intervention-list">{interventions.map(({ id, title, subtitle, source, icon: Icon }) => <div className={enabled[id] ? "enabled" : ""} key={id}><span className="intervention-icon"><Icon /></span><label><b>{title}</b><small>{subtitle}</small><SourceTag kind={source} /></label><Switch checked={enabled[id]} onCheckedChange={() => toggle(id)} aria-label={`Toggle ${title}`} /></div>)}</div><div className="stage-note"><ShieldCheck /><p><b>Stage gate</b>The damper stays optional. Install it only if field inspection confirms a shared branch and logged waste pays back.</p></div></article><article className="panel forecast-panel"><div className="forecast-header"><span>MODELLED REDUCTION</span><SourceTag kind="MODELLED" /></div><div className="forecast-orb"><i style={{ "--progress": `${Math.min(100, scenario.percent * 2.5)}%` } as React.CSSProperties} /><div><b>{scenario.percent.toFixed(0)}%</b><span>{scenario.daily.toFixed(1)} kWh / weekday</span></div></div><div className="forecast-metrics"><div><span>ANNUAL ENERGY</span><b>{Math.round(scenario.annualKwh).toLocaleString()} kWh</b></div><div><span>AVOIDED COST</span><b>S${Math.round(scenario.annualCost).toLocaleString()}</b></div><div><span>PLANNING CAPEX</span><b>S${Math.round(scenario.capex).toLocaleString()}</b></div><div><span>SIMPLE PAYBACK</span><b>{scenario.payback ? `${scenario.payback.toFixed(1)} yrs` : "—"}</b></div></div><div className="savings-bars"><ResponsiveContainer width="100%" height="100%"><BarChart data={scenario.rows.filter((row) => row.kwh > 0)} layout="vertical" margin={{ top: 0, right: 32, left: 4, bottom: 0 }}><XAxis type="number" hide /><YAxis dataKey="label" type="category" width={108} tick={{ fill: "#78909a", fontSize: 9 }} tickLine={false} axisLine={false} /><Tooltip cursor={{ fill: "#ffffff05" }} formatter={(value) => [`${Number(value).toFixed(2)} kWh/day`, "Saving"]} contentStyle={{ background: "#071317", border: "1px solid #26434b", borderRadius: 8, fontSize: 10 }} /><Bar dataKey="kwh" radius={[0, 4, 4, 0]}>{scenario.rows.filter((row) => row.kwh > 0).map((row) => <Cell key={row.id} fill={row.color} />)}</Bar></BarChart></ResponsiveContainer></div><p className="fine-print">260 weekdays · S${values.tariff.toFixed(2)}/kWh · 0.40 kgCO₂e/kWh · HVAC actions derated 20% for overlap · all costs are planning allowances.</p></article></section>
            <section className="lab-grid"><article className="panel slider-panel"><PanelHeading index="02" title="Operating assumptions" note="EDIT LIVE" /><div className="sliders"><label><span><Clock3 />FCU start time removed</span><b>{values.startTrim.toFixed(1)} h</b><Slider min={0} max={4.5} step={0.5} value={[values.startTrim]} onValueChange={(v) => setValue("startTrim", v[0])} /></label><label><span><Clock3 />FCU end overrun removed</span><b>{values.endTrim.toFixed(1)} h</b><Slider min={0} max={2} step={0.5} value={[values.endTrim]} onValueChange={(v) => setValue("endTrim", v[0])} /></label><label><span><Thermometer />Occupied setpoint</span><b>{values.setpoint.toFixed(1)}°C</b><Slider min={25} max={27} step={0.5} value={[values.setpoint]} onValueChange={(v) => setValue("setpoint", v[0])} /></label><label><span><Sun />Solar-control area</span><b>{values.solarArea} m²</b><Slider min={0} max={60} step={2} value={[values.solarArea]} onValueChange={(v) => setValue("solarArea", v[0])} /></label><label><span><Lightbulb />S15 hours trimmed</span><b>{values.lightingTrim.toFixed(1)} h</b><Slider min={0} max={3} step={0.5} value={[values.lightingTrim]} onValueChange={(v) => setValue("lightingTrim", v[0])} /></label><label><span><PlugZap />Baseload hours removed</span><b>{values.plugHours} h</b><Slider min={0} max={16} step={1} value={[values.plugHours]} onValueChange={(v) => setValue("plugHours", v[0])} /></label></div></article><article className="panel comfort-lab"><PanelHeading index="03" title="Comfort guardrail" note="PMV / PPD SCREENING" /><div className={`comfort-verdict ${comfortOk ? "pass" : "review"}`}><div><span>{comfortOk ? "COMFORT GATE PASSES" : "REVIEW REQUIRED"}</span><b>PMV {comfort.pmv.toFixed(2)}</b><small>PPD {comfort.ppd.toFixed(0)}%</small></div><Gauge /></div><div className="comfort-controls"><label><span>Air speed</span><b>{enabled.fans ? values.airSpeed.toFixed(2) : "0.10"} m/s</b><Slider disabled={!enabled.fans} min={0.1} max={0.8} step={0.05} value={[values.airSpeed]} onValueChange={(v) => setValue("airSpeed", v[0])} /></label><label><span>Relative humidity</span><b>{humidity}%</b><Slider min={40} max={70} step={5} value={[humidity]} onValueChange={(v) => setHumidity(v[0])} /></label></div><div className="comfort-scale"><span>COOL</span><i><em style={{ left: `${Math.max(0, Math.min(100, (comfort.pmv + 1) * 50))}%` }} /></i><span>WARM</span></div><p className="fine-print">Fanger PMV screening at 1.0 met, 0.61 clo and operative temperature equal to setpoint. Elevated-air-speed compliance must be validated with the CBE Thermal Comfort Tool and an occupant survey.</p></article></section>
          </TabsContent>

          <TabsContent value="economics" className="tab-content">
            <section className="section-intro"><div><span>COMMERCIAL CASE</span><h2>Buy evidence first.<br /><em>Hardware second.</em></h2></div><p>The rollout is structured to capture scheduling savings immediately and prevent a premature damper or controls purchase.</p></section>
            <section className="business-kpis"><article><span>SELECTED CAPEX</span><b>S${Math.round(scenario.capex).toLocaleString()}</b><p>Planning allowance for {values.scale} pilot zone{values.scale > 1 ? "s" : ""}</p></article><article><span>ANNUAL AVOIDED COST</span><b>S${Math.round(scenario.annualCost).toLocaleString()}</b><p>At S${values.tariff.toFixed(2)} per kWh</p></article><article><span>SIMPLE PAYBACK</span><b>{scenario.payback ? scenario.payback.toFixed(1) : "—"} years</b><p>Before incentives and maintenance effects</p></article><article><span>CARBON AVOIDED</span><b>{scenario.carbon.toFixed(2)} tCO₂e</b><p>Using a model input of 0.40 kg/kWh</p></article></section>
            <section className="economics-grid"><article className="panel capex-panel"><PanelHeading index="01" title="Selected pilot bill" note="PLANNING ALLOWANCES" /><div className="capex-list">{scenario.rows.filter((row) => row.capex > 0).map((row) => <div key={row.id}><span><i style={{ background: row.color }} />{row.label}</span><b>S${Math.round(row.capex * values.scale).toLocaleString()}</b></div>)}<div className="capex-total"><span>TOTAL</span><b>S${Math.round(scenario.capex).toLocaleString()}</b></div></div><p className="fine-print">Budget numbers are placeholders for supplier quotations—not procurement claims.</p></article><article className="panel scale-panel"><PanelHeading index="02" title="Scale estimator" note="1–8 COMPARABLE ZONES" /><div className="scale-number"><span>ROLLOUT</span><b>{values.scale}</b><small>zone{values.scale > 1 ? "s" : ""}</small></div><Slider min={1} max={8} step={1} value={[values.scale]} onValueChange={(v) => setValue("scale", v[0])} /><div className="scale-axis"><span>1 PILOT</span><span>8 ZONES</span></div><div className="tariff-control"><span>Electricity assumption</span><div><button onClick={() => setValue("tariff", Math.max(0.20, values.tariff - 0.01))}>−</button><b>S${values.tariff.toFixed(2)}/kWh</b><button onClick={() => setValue("tariff", Math.min(0.50, values.tariff + 0.01))}>+</button></div></div><div className="scale-callout"><TrendingDown /><p><b>{Math.round(scenario.annualKwh).toLocaleString()} kWh/year</b>Potential across the selected rollout, pending zone-by-zone validation.</p></div></article></section>
            <section className="value-ladder"><div><span>PHASE 0</span><b>Recommission schedules</b><p>Immediate, reversible, low capex</p></div><ArrowRight /><div><span>PHASE 1</span><b>Controls + comfort trial</b><p>Measure occupants, temperature and plug persistence</p></div><ArrowRight /><div><span>PHASE 2</span><b>Selective retrofit</b><p>Film or damper only where the evidence clears payback</p></div></section>
          </TabsContent>

          <TabsContent value="deployment" className="tab-content">
            <section className="section-intro"><div><span>IMPLEMENTATION PLAYBOOK</span><h2>One floor. Ninety days.<br /><em>Four hard gates.</em></h2></div><p>A practical pilot built for SUSS facilities—not a speculative campus-wide installation.</p></section>
            <section className="roadmap">{pilotPhases.map((phase, index) => <article key={phase.day}><span>0{index + 1}</span><small>{phase.day}</small><h3>{phase.title}</h3><p>{phase.body}</p><div><Check /> EXIT GATE</div></article>)}</section>
            <section className="deployment-grid"><article className="panel success-panel"><PanelHeading index="01" title="Success contract" note="AGREE BEFORE INSTALLATION" /><div className="success-list"><div><b>≥15%</b><span>weather-matched pilot energy reduction</span></div><div><b>≤10%</b><span>predicted dissatisfied / PPD screen</span></div><div><b>0</b><span>increase in substantiated comfort complaints</span></div><div><b>100%</b><span>critical plug loads whitelisted</span></div></div></article><article className="panel risk-panel"><PanelHeading index="02" title="Failure modes designed out" note="FACILITIES READY" /><div className="risk-list"><div><ShieldCheck /><span><b>Indoor air quality</b>Minimum ventilation and CO₂ alarms override savings.</span></div><div><ShieldCheck /><span><b>Pressure instability</b>Damper command coordinates with fan and valve control.</span></div><div><ShieldCheck /><span><b>Occupant privacy</b>Count people; do not identify people.</span></div><div><ShieldCheck /><span><b>Essential equipment</b>Plug whitelist prevents unsafe switching.</span></div></div></article></section>
            <section className="architecture"><div><span>SENSORS</span><b>Occupancy · temperature · CO₂ · circuit meters</b></div><ChevronRight /><div><span>COOLSENSE EDGE</span><b>Rules · comfort gate · fail-safe</b></div><ChevronRight /><div><span>EXISTING SYSTEMS</span><b>Timers · BMS · valves · approved sockets</b></div><ChevronRight /><div><span>VERIFICATION</span><b>Dashboard · M&V · facilities sign-off</b></div></section>
            <article className="final-ask"><div><span>THE DEMO-DAY ASK</span><h2>Approve access to one FCU branch, S15 and P21–P27 for a 90-day Level 6 pilot.</h2></div><Button onClick={() => { setPitchStep(0); setPitchOpen(true); }}><Play />LAUNCH PITCH MODE</Button></article>
          </TabsContent>
        </Tabs>
        <footer><div><Waves /><b>COOLSENSE SUSS</b><span>PLANET RESILIENCE · 2026</span></div><p>Built from the supplied hackathon drawings, sample profiles and walkthrough observations. All savings and costs are modelled planning estimates pending a metered pilot.</p></footer>
      </section>
    </div>

    {pitchOpen ? <div className="pitch-overlay" role="dialog" aria-modal="true" aria-label="CoolSense pitch mode"><div className="pitch-top"><div className="pitch-brand"><Waves /><b>COOLSENSE</b><span>JUDGE MODE</span></div><div className="pitch-progress">{pitchSlides.map((_, index) => <i key={index} className={index <= pitchStep ? "active" : ""} />)}</div><button onClick={() => setPitchOpen(false)} aria-label="Close pitch"><X /></button></div><div className="pitch-stage">{pitchSlides[pitchStep]}</div><div className="pitch-controls"><span>{String(pitchStep + 1).padStart(2, "0")} / 05</span><div><button disabled={pitchStep === 0} onClick={() => setPitchStep((step) => step - 1)}>BACK</button><button className="pitch-next" onClick={() => pitchStep === 4 ? setPitchOpen(false) : setPitchStep((step) => step + 1)}>{pitchStep === 4 ? "EXIT" : "NEXT"}<ArrowRight /></button></div><small>Use ← → arrow keys</small></div></div> : null}
  </main>;
}
