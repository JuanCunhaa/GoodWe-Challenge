// src/components/cards/Baterias.jsx
import { Battery, Zap, Thermometer, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import BatteryBar from "./BatteryBar.jsx";
import { goodweApi } from "../../services/goodweApi.js";
const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp = { y: -8, opacity: 0, transition: { duration: 0.18 } };
function healthMeta(pct) {
  const v = Number(pct || 0);
  if (v >= 85) return { label: "Excelente", textClass: "text-green-600", chipBg: "bg-green-50", chipText: "text-green-700" };
  if (v >= 70) return { label: "Moderada", textClass: "text-yellow-600", chipBg: "bg-yellow-50", chipText: "text-yellow-700" };
  return { label: "Decadente", textClass: "text-red-600", chipBg: "bg-red-50", chipText: "text-red-700" };
}
function tempMeta(c) {
  const v = Number(c || 0);
  if (v >= 45) return { textClass: "text-red-600", iconClass: "text-red-600" };
  if (v >= 35) return { textClass: "text-orange-600", iconClass: "text-orange-600" };
  return { textClass: "text-blue-600", iconClass: "text-blue-600" };
}
function toPctFrac(soc) {
  const n = parseFloat(String(soc).replace("%", ""));
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n / 100));
}
function parseVAW(str) {
  // Ex.: "299.3/0.7/210" => { v:299.3, a:0.7, w:210 }
  try {
    const [v, a, w] = String(str || "").split("/");
    return { v: parseFloat(v), a: parseFloat(a), w: parseFloat(w) };
  } catch { return { v: null, a: null, w: null }; }
}
function Sparkline({ values = [], height = 40, color = "#10b981" }) {
  if (!values || values.length === 0) return <div className="h-[40px] muted text-xs">Sem dados</div>;
  const w = 220; const h = height;
  const min = Math.min(...values); const max = Math.max(...values);
  const normY = (v) => max === min ? h / 2 : h - ((v - min) / (max - min)) * h;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${normY(v)}`).join(" ");
  return (
    <svg width={w} height={h} className="block w-full max-w-[260px]">
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
}
export default function Baterias() {
  const [items, setItems] = useState([]);           // lista por inversor
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState({ type: "main", index: null }); // main | detail
  // Complementos por planta
  const [plantCapKwh, setPlantCapKwh] = useState(null); // /plant-detail
  const [socSeries, setSocSeries] = useState([]);       // /power-chart PCurve_Power_SOC
  const [socStats, setSocStats] = useState({ min: null, max: null });
  const [batPeak, setBatPeak] = useState({ value: null, time: null }); // pico PCurve_Power_Battery
  const b = view.index != null ? items[view.index] : null;
  const health = b ? healthMeta(Number(b.soh || 90)) : healthMeta(0);
  const tmeta = b ? tempMeta(Number(b.temp_c || 0)) : tempMeta(0);
  useEffect(() => {
    const run = () => { try { refresh(); } catch {} };
    run();
    const base = Number(import.meta.env.VITE_REFRESH_MS || 10000);
    const ms = Number(import.meta.env.VITE_REFRESH_MS_BATTERY || base);
    const id = setInterval(run, Math.max(5000, ms));
    const onFocus = () => run();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);
  async function refresh() {
    const token = localStorage.getItem("token");
    const user = JSON.parse(localStorage.getItem("user") || "null");
    if (!token || !user?.powerstation_id) return;
    setLoading(true); setError("");
    try {
      // 1) Inverters (base)
      const inv = await goodweApi.inverters(token, user.powerstation_id);
      if (String(inv?.code) !== "0" && String(inv?.code) !== "000") throw new Error(inv?.msg || "Falha ao consultar inversores");
      const list = inv?.data?.inverterPoints || [];
      const mapped = list.map((it) => {
        const dict = it?.dict || {}; const left = dict.left || []; const right = dict.right || [];
        const kv = (key) => { const x = [...left, ...right].find((e) => e?.key === key); return x?.value; };
        const temp = kv("innerTemp") ?? kv("BMS_Temperature");
        const status = it?.batteryStatus || it?.gridConnStatus || "-";
        const bmsLimC = kv("chargeClimitBMS");
        const bmsLimD = kv("dischargeClimitBMS");
        const bmsVer = kv("BMSSoftwareVersion");
        const rssi = kv("RSSI");
        const pow = parseVAW(kv("StatusOfBattery"));
        return {
          name: it?.name || it?.sn,
          sn: it?.sn,
          soc: it?.soc || "-",
          vb: it?.vbattery1,
          ib: it?.ibattery1,
          out_pac: it?.out_pac,
          eday: it?.eday,
          temp_c: temp,
          soh: kv("SOH"),
          capacity_decl_kw: kv("DeviceParameter_capacity"),
          status,
          last: it?.last_refresh_time || it?.local_date,
          bmsLimC, bmsLimD, bmsVer, rssi,
          batt_w: pow?.w,
        };
      });
      setItems(mapped);
      // 2) Plant detail (capacidade kWh real)
      try {
        const det = await goodweApi.plantDetail(token, user.powerstation_id);
        const capk = det?.data?.info?.battery_capacity;
        if (capk != null) setPlantCapKwh(capk);
      } catch {}
      // 3) Power chart (SOC e pico bateria) – dia atual
      try {
        const d = new Date(); const date = d.toISOString().slice(0, 10);
        const chart = await goodweApi.powerChartDay(token, user.powerstation_id, date);
        if (String(chart?.code) === "0") {
          const lines = chart?.data?.lines || [];
          const find = (k) => lines.find((l) => l?.key === k);
          const soc = find("PCurve_Power_SOC");
          const bat = find("PCurve_Power_Battery");
          if (soc?.xy?.length) {
            const ys = soc.xy.map((p) => Number(p?.y ?? 0));
            setSocSeries(ys);
            setSocStats({ min: Math.min(...ys), max: Math.max(...ys) });
          }
          if (bat?.xy?.length) {
            const best = bat.xy.reduce((acc, p) => (p?.y > acc.value ? { value: p.y, time: p.x } : acc), { value: -Infinity, time: null });
            if (isFinite(best.value)) setBatPeak(best);
          }
        }
      } catch {}
    } catch (e) {
      setError(String(e.message || e));
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  return (
    <div className="relative card p-6 rounded-2xl border border-blue-200 bg-blue-50 shadow overflow-hidden">
      {/* Header */}
      <div className="-mx-6 -mt-6 px-6 py-3 bg-blue-600 text-white rounded-t-2xl flex items-center gap-2 relative">
        {view.type !== "main" && (
          <button onClick={() => setView({ type: "main", index: null })} className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-md hover:bg-white/10" aria-label="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <Battery className="w-5 h-5" />
        <span className="text-lg font-bold">Baterias</span>
        {view.type === "main" && (
          <div className="ml-auto text-sm">{loading ? "Carregando…" : (error ? <span className="text-red-700">{error}</span> : null)}</div>
        )}
      </div>
      <div className="relative mt-4 min-h-[430px]">
        <AnimatePresence mode="wait">
          {view.type === "main" ? (
            <motion.div key="main" initial={{ opacity: 1 }} exit={exitUp} className="space-y-3">
              {items.map((bat, i) => (
                <motion.button key={bat.sn || i} whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }} onClick={() => setView({ type: "detail", index: i })} className="group relative w-full h-12 rounded-xl bg-blue-600 text-white pl-4 pr-12 flex items-center justify-between active:scale-[.99]">
                  <span className="truncate mr-3">{bat.name}</span>
                  <div className="pointer-events-none">
                    <BatteryBar value={toPctFrac(bat.soc)} outline showPercent />
                  </div>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    <span className="relative inline-block">
                      <Battery className="w-4 h-4 opacity-90" />
                      {String(bat.status || "").toLowerCase().includes("charge") && (
                        <Zap className="w-3 h-3 text-yellow-400 absolute -top-2 -right-2 drop-shadow icon-wobble icon-wable" />
                      )}
                    </span>
                  </span>
                </motion.button>
              ))}
              {!loading && items.length === 0 && (
                <div className="muted">Nenhuma bateria encontrada para esta planta.</div>
              )}
            </motion.div>
          ) : view.type === "detail" ? (
            <motion.div key="detail" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: springIn }} exit={exitUp} className="space-y-4">
              {/* Cabeçalho interno */}
              <div className="rounded-xl bg-white/70 p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Battery className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-gray-800">{b?.name || b?.sn || "Bateria"} <span className="font-normal text-gray-500">({b?.sn || "-"})</span></span>
                </div>
                <div className="text-xs text-gray-600">Atualizado: {b?.last || "—"}</div>
              </div>
              {/* SOC + Status + Potência bateria */}
              <div className="rounded-xl bg-white/85 p-4 grid grid-cols-3 gap-3 items-center">
                <div className="col-span-2">
                  <div className="text-sm text-gray-600 mb-1">Carga</div>
                  <BatteryBar value={toPctFrac(b?.soc)} height={26} width={180} showPercent />
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-600">Status</div>
                  <div className="font-semibold text-gray-800">{b?.status || "—"}</div>
                  <div className="text-xs text-gray-600 mt-1">Potência</div>
                  <div className="font-semibold text-gray-800">{b?.batt_w != null ? `${Number(b.batt_w).toLocaleString('pt-BR')} W` : '—'}</div>
                </div>
              </div>
              {/* Health / Temp */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className={`text-2xl font-extrabold ${health.textClass}`}>{b?.soh ?? "—"}%</div>
                  <div className="text-xs text-gray-600">Saúde (SOH)</div>
                  <div className={`mt-2 inline-flex px-3 py-1 rounded-full text-xs ${health.chipBg} ${health.chipText}`}>{health.label}</div>
                </div>
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className={`text-2xl font-extrabold ${tmeta.textClass}`}>
                    <Thermometer className={`inline w-4 h-4 -mt-1 mr-1 ${tmeta.iconClass}`} />
                    {b?.temp_c ?? "—"}°C
                  </div>
                  <div className="text-xs text-gray-600">Temperatura</div>
                </div>
              </div>
              {/* Bateria */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="font-semibold text-gray-800 mb-2">Bateria</div>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <span className="text-gray-600">Capacidade (decl.):</span>
                  <span className="text-right font-semibold text-gray-800">{b?.capacity_decl_kw ? `${b.capacity_decl_kw} kW` : "—"}</span>
                  <span className="text-gray-600">Capacidade da planta:</span>
                  <span className="text-right font-semibold text-gray-800">{plantCapKwh != null ? `${plantCapKwh} kWh` : "—"}</span>
                  <span className="text-gray-600">Tensão (V):</span>
                  <span className="text-right font-semibold text-gray-800">{b?.vb ?? "—"}</span>
                  <span className="text-gray-600">Corrente (A):</span>
                  <span className="text-right font-semibold text-gray-800">{b?.ib ?? "—"}</span>
                  <span className="text-gray-600">Limite carga BMS (A):</span>
                  <span className="text-right font-semibold text-gray-800">{b?.bmsLimC ?? "—"}</span>
                  <span className="text-gray-600">Limite descarga BMS (A):</span>
                  <span className="text-right font-semibold text-gray-800">{b?.bmsLimD ?? "—"}</span>
                </div>
              </div>
              {/* SOC do dia + Pico potência bateria */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-gray-800">SOC (hoje)</div>
                  <div className="text-xs text-gray-600">{socStats.min != null && socStats.max != null ? `min ${socStats.min}% • máx ${socStats.max}%` : "—"}</div>
                </div>
                <Sparkline values={socSeries} height={40} color="#10b981" />
                <div className="mt-3 text-sm text-gray-700">Pico Potência Bateria: {batPeak.value != null ? `${Number(batPeak.value).toLocaleString('pt-BR')} W` : '—'} {batPeak.time ? `• ${batPeak.time}` : ''}</div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
