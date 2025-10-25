import { useEffect, useMemo, useState } from "react";
import { Sun, CloudSun, Cloud, CloudRain, Umbrella, Wind, Droplet, Thermometer, CalendarDays, ArrowLeft } from "lucide-react";
import { goodweApi } from "../../services/goodweApi.js";
import { motion, AnimatePresence } from "framer-motion";

const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp = { y: -8, opacity: 0, transition: { duration: 0.18 } };

function pickIcon(cond = "") {
  const s = String(cond).toLowerCase();
  if (s.includes("rain") || s.includes("chuva")) return CloudRain;
  if (s.includes("cloud") || s.includes("nublado") || s.includes("partly")) return CloudSun;
  if (s.includes("sun") || s.includes("ensolarado") || s.includes("sunny")) return Sun;
  return Cloud;
}

function translateCond(txt = ""){
  const s = String(txt).toLowerCase();
  const map = [
    [/^sunny$/, "Ensolarado"],
    [/^clear$/, "Céu limpo"],
    [/^cloudy$/, "Nublado"],
    [/^overcast$/, "Encoberto"],
    [/^partly\s*cloudy$/, "Parcialmente nublado"],
    [/^few\s*clouds?$/, "Poucas nuvens"],
    [/^light\s*rain$/, "Chuva fraca"],
    [/^moderate\s*rain$/, "Chuva moderada"],
    [/^heavy\s*rain$/, "Chuva forte"],
    [/^shower\s*rain$/, "Pancadas de chuva"],
    [/^thundershower$/, "Pancadas c/ trovoadas"],
    [/^snow$/, "Neve"],
  ];
  for (const [re, pt] of map){ if (re.test(s)) return pt; }
  // palavras soltas
  if (s.includes("shower")) return "Pancadas de chuva";
  if (s.includes("rain")) return "Chuva";
  if (s.includes("cloud")) return "Nublado";
  if (s.includes("sun")) return "Ensolarado";
  return txt;
}

function translateWindDir(dir = ""){
  const d = String(dir).toUpperCase();
  const map = {
    N: "N",
    S: "S",
    E: "L",
    W: "O",
    NE: "NE",
    NW: "NO",
    SE: "SE",
    SW: "SO",
    ENE: "LNE",
    ESE: "LSE",
    WNW: "ONO",
    WSW: "OSO",
    NNE: "NNE",
    NNW: "NNO",
    SSE: "SSE",
    SSW: "SSO",
  };
  return map[d] || dir;
}

function iconDimsFor(cond = ""){
  const s = String(cond).toLowerCase();
  // Chuva/pancadas -> ícone maior; demais -> um pouco menor
  if (s.includes("chuva") || s.includes("rain")) {
    return { size: "w-10 h-10", stroke: 2.6 };
  }
  return { size: "w-6 h-6", stroke: 1.8 };
}

function DayChip({ date }){
  try {
    const d = new Date(date);
    return <span className="text-xs text-gray-300">{d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}</span>
  } catch { return <span className="text-xs text-gray-600">{date}</span>; }
}

export default function ClimaTempo(){
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forecast, setForecast] = useState([]); // daily_forecast[]
  const [view, setView] = useState("main"); // main | detail

  useEffect(() => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!token || !user?.powerstation_id) return;
    (async () => {
      setLoading(true); setError("");
      try {
        const j = await goodweApi.weather(token, user.powerstation_id);
        if (String(j?.code) !== '0') throw new Error(j?.msg || 'Falha ao consultar clima');
        const df = j?.data?.weather?.HeWeather6?.[0]?.daily_forecast || [];
        setForecast(Array.isArray(df) ? df : []);
      } catch (e) {
        setError(String(e.message || e));
      } finally { setLoading(false); }
    })();
  }, []);

  const today = forecast[0] || null;
  const nextDays = useMemo(() => (forecast || []).slice(1, 4), [forecast]);
  const condToday = translateCond(today?.cond_txt_d || today?.cond_txt_n || "");
  const Icon = pickIcon(condToday);
  const dimsToday = iconDimsFor(condToday);

  return (
    <div className="relative card p-6 rounded-2xl border border-purple-200 bg-purple-50 shadow overflow-hidden">
      {/* header */}
      <div className="-mx-6 -mt-6 px-6 py-3 bg-purple-600 text-white rounded-t-2xl flex items-center gap-2 relative">
        {view !== 'main' && (
          <button
            onClick={() => setView('main')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-md hover:bg-white/10"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <CloudSun className="w-5 h-5"/>
        <span className="text-lg font-bold">Clima & Tempo</span>
      </div>

      <div className="relative mt-4 min-h-[200px]">
        <AnimatePresence mode="wait">
          {view === 'main' ? (
            <motion.div key="main" initial={{ opacity: 1 }} exit={exitUp} className="space-y-4">
              {/* Hoje */}
              <div className="panel grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div className="col-span-2">
                  <div className="flex items-center gap-2 text-purple-200">
                    <Icon className={dimsToday.size + ""} strokeWidth={dimsToday.stroke}/>
                    <div className="text-lg font-semibold text-white">{loading ? 'Carregando...' : (condToday || 'Sem dados')}</div>
                  </div>
                  <div className="mt-1 text-gray-100">
                    <span className="font-semibold text-2xl text-white">{today ? `${today.tmp_min}° / ${today.tmp_max}°` : '--'}</span>
                  </div>
                  {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
                </div>
                <div className="md:text-right text-sm text-gray-200 flex md:justify-end flex-wrap gap-x-4 gap-y-1">
                  <div className="inline-flex items-center gap-1"><Thermometer className="w-4 h-4"/> Máx: {today?.tmp_max ?? '--'}°</div>
                  <div className="inline-flex items-center gap-1"><Thermometer className="w-4 h-4"/> Mín: {today?.tmp_min ?? '--'}°</div>
                  <div className="inline-flex items-center gap-1"><Droplet className="w-4 h-4"/> Umidade: {today?.hum ?? '--'}%</div>
                </div>
              </div>

              {/* Métricas rápidas (tiles alinhados) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="panel h-20 flex flex-col items-center justify-center">
                  <div className="text-[11px] uppercase tracking-wide muted whitespace-nowrap">Vento</div>
                  <div className="mt-1 font-semibold text-gray-100 inline-flex items-center gap-1"><Wind className="w-4 h-4 text-purple-300"/>{translateWindDir(today?.wind_dir || '--')} {today?.wind_spd ? `${today.wind_spd} km/h` : ''}</div>
                </div>
                <div className="panel h-20 flex flex-col items-center justify-center">
                  <div className="text-[11px] uppercase tracking-wide muted whitespace-nowrap">UV</div>
                  <div className="mt-1 font-semibold text-gray-100">{today?.uv_index ?? '--'}</div>
                </div>
                <div className="panel h-20 flex flex-col items-center justify-center">
                  <div className="text-[11px] uppercase tracking-wide muted whitespace-nowrap">Precipitação</div>
                  <div className="mt-1 font-semibold text-gray-100 inline-flex items-center gap-1"><Umbrella className="w-4 h-4 text-purple-300"/>{today?.pcpn ?? '0.0'} mm</div>
                </div>
                <div className="panel h-20 flex flex-col items-center justify-center">
                  <div className="text-[11px] uppercase tracking-wide muted whitespace-nowrap">Prob. Chuva</div>
                  <div className="mt-1 font-semibold text-gray-100">{today?.pop ?? '0'}%</div>
                </div>
              </div>

              {/* Previsão próximos dias */}
              <div className="panel p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-gray-100 inline-flex items-center gap-2"><CalendarDays className="w-4 h-4 text-purple-300"/>Próximos dias</div>
                  <button onClick={()=>setView('detail')} className="text-xs text-purple-300 hover:underline">Ver detalhado</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
                  {nextDays.map((d, i) => {
                    const cond = translateCond(d?.cond_txt_d || d?.cond_txt_n || '');
                    const I = pickIcon(cond);
                    const dims = iconDimsFor(cond);
                    return (
                      <div key={i} className="panel p-3 text-center h-36 flex flex-col items-center justify-center">
                        <div className="mb-1"><DayChip date={d?.date}/></div>
                        <I className={`${dims.size} mx-auto text-purple-300 mb-1`} strokeWidth={dims.stroke}/>
                        <div className="text-xs text-gray-300 leading-tight break-words text-center">{cond || '-'}</div>
                        <div className="mt-1 font-semibold text-gray-100">{d?.tmp_min ?? '--'}° / {d?.tmp_max ?? '--'}°</div>
                      </div>
                    );
                  })}
                  {nextDays.length === 0 && (
                    <div className="muted">Sem dados de previsão.</div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="detail" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: springIn }} exit={exitUp} className="space-y-3">
              <div className="rounded-2xl bg-white/85 p-4">
                <div className="font-semibold text-gray-800 mb-2">Previsão detalhada</div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(forecast || []).map((d, i) => {
                    const I = pickIcon(d?.cond_txt_d || d?.cond_txt_n || '');
                    return (
                      <div key={i} className="rounded-xl border border-purple-100 bg-white/90 p-3">
                        <div className="flex items-center justify-between">
                          <DayChip date={d?.date}/>
                          <I className="w-5 h-5 text-purple-700"/>
                        </div>
                        <div className="text-sm text-gray-700 mt-1">{d?.cond_txt_d || d?.cond_txt_n || '-'}</div>
                        <div className="mt-1 text-sm text-gray-700">Vento: {d?.wind_dir || '--'} {d?.wind_spd ? `${d.wind_spd} km/h` : ''}</div>
                        <div className="text-sm text-gray-700">Umidade: {d?.hum ?? '--'}%</div>
                        <div className="text-sm text-gray-700">UV: {d?.uv_index ?? '--'}</div>
                        <div className="text-sm text-gray-700">Precipitação: {d?.pcpn ?? '0.0'} mm • Prob.: {d?.pop ?? '0'}%</div>
                        <div className="mt-1 font-semibold text-gray-900">{d?.tmp_min ?? '--'}° / {d?.tmp_max ?? '--'}°</div>
                      </div>
                    );
                  })}
                  {forecast.length === 0 && <div className="muted">Sem dados.</div>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
