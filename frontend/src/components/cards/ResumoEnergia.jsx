import { useEffect, useState, useMemo } from 'react'
import { Zap, BatteryCharging, Battery, PlugZap, Gauge, ArrowLeftRight } from 'lucide-react'
import { goodweApi, convertToBRL } from '../../services/goodweApi.js'

function toNum(v){
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9+\-\.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseInverterPower(item){
  // Prefer it.out_pac; fallback to dict.ouptputPower (typo do SEMS)
  const dict = item?.dict || {}; const left = dict.left || []; const right = dict.right || [];
  const kv = (k)=> ([...left, ...right].find((e)=>e?.key===k)?.value);
  const outPac = toNum(item?.out_pac);
  const alt = toNum(kv('ouptputPower'));
  return outPac ?? alt ?? 0;
}

function parseBatteryW(item){
  // StatusOfBattery: "V/A/W" -> pega W (positivo: descarregando, negativo: carregando)
  try {
    const dict = item?.dict || {}; const left = dict.left || []; const right = dict.right || [];
    const kv = (k)=> ([...left, ...right].find((e)=>e?.key===k)?.value);
    const vaw = String(kv('StatusOfBattery') || '').split('/')
    const w = toNum(vaw[2]);
    return Number.isFinite(w) ? w : null;
  } catch { return null; }
}

export default function ResumoEnergia(){
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pvW, setPvW] = useState(null)
  const [battW, setBattW] = useState(null)
  const [loadW, setLoadW] = useState(null)
  const [gridW, setGridW] = useState(null)
  const [currency, setCurrency] = useState(null) // moeda da conta/planta (ex.: BRL, USD, EUR)

  useEffect(()=>{
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    ;(async()=>{
      setLoading(true); setError('')
      try{
        // 1) Powerflow (para load/grid quando disponíveis)
        try{
          const pf = await goodweApi.powerflow(token, user.powerstation_id)
          const p = pf?.data?.powerflow || pf?.data?.powerFlow || pf?.powerflow
          if (p){
            setLoadW(toNum(p.load))
            setGridW(toNum(p.grid))
          }
        }catch{}
        // 2) Inversores (para PV e Bateria)
        try{
          const inv = await goodweApi.inverters(token, user.powerstation_id)
          const list = inv?.data?.inverterPoints || []
          const totalPv = list.reduce((acc, it)=> acc + (parseInverterPower(it) || 0), 0)
          setPvW(Number.isFinite(totalPv) ? totalPv : null)
          // pega o primeiro com info de bateria válida
          const firstBatt = list.map(parseBatteryW).find(v => v!=null)
          if (firstBatt!=null) setBattW(firstBatt)
        }catch{}

        // 3) Moeda/preço por região a partir do SEMS (plant detail preferencialmente)
        try{
          const det = await goodweApi.plantDetail(token, user.powerstation_id)
          const cur = String(det?.data?.kpi?.currency || '').toUpperCase()
          if (cur) setCurrency(cur)
          else {
            // fallback: monitor
            const mon = await goodweApi.monitor(token, user.powerstation_id)
            const cur2 = String(mon?.data?.list?.[0]?.currency || '').toUpperCase()
            if (cur2) setCurrency(cur2)
          }
        }catch{}
      }catch(e){ setError(String(e.message || e)) }
      finally{ setLoading(false) }
    })()
  },[])

  // Auto-refresh interval
  useEffect(()=>{
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!token || !user?.powerstation_id) return
    let cancelled = false
    const run = async()=>{
      try{
        // Powerflow
        try{
          const pf = await goodweApi.powerflow(token, user.powerstation_id)
          const p = pf?.data?.powerflow || pf?.data?.powerFlow || pf?.powerflow
          if (p && !cancelled){
            setLoadW(toNum(p.load))
            setGridW(toNum(p.grid))
          }
        }catch{}
        // Inverters
        try{
          const inv = await goodweApi.inverters(token, user.powerstation_id)
          const list = inv?.data?.inverterPoints || []
          const totalPv = list.reduce((acc, it)=> acc + (parseInverterPower(it) || 0), 0)
          if (!cancelled) setPvW(Number.isFinite(totalPv) ? totalPv : null)
          const firstBatt = list.map(parseBatteryW).find(v => v!=null)
          if (firstBatt!=null && !cancelled) setBattW(firstBatt)
        }catch{}
        // Currency
        try{
          const det = await goodweApi.plantDetail(token, user.powerstation_id)
          const cur = String(det?.data?.kpi?.currency || '').toUpperCase()
          if (cur && !cancelled) setCurrency(cur)
        }catch{}
      }catch{}
    }
    const base = Number(import.meta.env.VITE_REFRESH_MS || 5000)
    const ms = Number(import.meta.env.VITE_REFRESH_MS_ENERGY || base)
    const id = setInterval(run, Math.max(1000, ms))
    const onFocus = ()=> run()
    window.addEventListener('focus', onFocus)
    return ()=>{ cancelled = true; clearInterval(id); window.removeEventListener('focus', onFocus) }
  },[])

  // Deriva grid se vier ausente mas houver pv/batt/load
  const gridDerived = useMemo(()=>{
    if (gridW!=null) return gridW
    if (loadW==null && pvW==null && battW==null) return null
    const l = loadW ?? 0; const p = pvW ?? 0; const b = battW ?? 0;
    return Math.round(l - p - b)
  }, [gridW, loadW, pvW, battW])

  const statusChips = useMemo(()=>{
    const chips = []
    if ((pvW ?? 0) > 100) chips.push({ label:'Gerando', cls:'bg-emerald-600/20 text-emerald-300 border-emerald-500/30', Icon: Zap })
    if ((battW ?? 0) < -100) chips.push({ label:'Carregando Bateria', cls:'bg-indigo-600/20 text-indigo-300 border-indigo-500/30', Icon: BatteryCharging })
    if ((battW ?? 0) > 100) chips.push({ label:'Usando Bateria', cls:'bg-purple-600/20 text-purple-300 border-purple-500/30', Icon: Battery })
    if ((gridDerived ?? 0) > 100) chips.push({ label:'Importando da Rede', cls:'bg-rose-600/20 text-rose-300 border-rose-500/30', Icon: PlugZap })
    if ((gridDerived ?? 0) < -100) chips.push({ label:'Exportando p/ Rede', cls:'bg-teal-600/20 text-teal-300 border-teal-500/30', Icon: ArrowLeftRight })
    return chips
  }, [pvW, battW, gridDerived])

  const fmtW = (w)=> w==null ? '—' : `${Math.round(w).toLocaleString('pt-BR')} W`

  // Tarifa por região detectada (da API) com fallback do env
  const tariffBRL = useMemo(() => {
    const up = (s)=> (s||'').toUpperCase();
    const num = (v)=> { const n = Number(v); return Number.isFinite(n) ? n : 0 };
    const detected = up(currency || '');
    const fallbackRegion = up(import.meta.env.VITE_TARIFF_REGION || 'BRL');
    const region = detected || fallbackRegion;
    const tBRL = num(import.meta.env.VITE_TARIFF_BRL_KWH);
    const tUSD = num(import.meta.env.VITE_TARIFF_USD_KWH);
    const tEUR = num(import.meta.env.VITE_TARIFF_EUR_KWH);
    const tGBP = num(import.meta.env.VITE_TARIFF_GBP_KWH);
    const tCNY = num(import.meta.env.VITE_TARIFF_CNY_KWH);
    const map = { BRL:tBRL, USD:tUSD, EUR:tEUR, GBP:tGBP, CNY:tCNY };
    const sel = map[region] || tBRL;
    if (!sel) return 0;
    if (region === 'BRL') return sel;
    return convertToBRL(sel, region);
  }, [currency]);

  const costPerHourBRL = useMemo(() => {
    const impW = Math.max(0, gridDerived ?? 0);
    if (!tariffBRL || !impW) return null;
    const kW = impW / 1000;
    return kW * tariffBRL; // R$/h instantâneo
  }, [gridDerived, tariffBRL]);

  const batterySavingsPerHourBRL = useMemo(() => {
    const disW = Math.max(0, battW ?? 0); // só quando descarregando
    if (!tariffBRL || !disW) return null;
    const kW = disW / 1000;
    return kW * tariffBRL; // economia estimada/h
  }, [battW, tariffBRL]);

  return (
    <div className="relative card p-6 rounded-2xl border border-orange-200 bg-orange-50 shadow overflow-hidden">
      <div className="-mx-6 -mt-6 px-6 py-3 bg-orange-600 text-white rounded-t-2xl flex items-center gap-2">
        <Gauge className="w-5 h-5"/>
        <span className="text-lg font-bold">Resumo de Energia</span>
        {loading && <span className="ml-auto text-xs">Atualizando…</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel text-center">
          <div className="text-xs text-gray-500">Geração</div>
          <div className="text-xl font-extrabold text-emerald-700">{fmtW(pvW)}</div>
        </div>
        <div className="panel text-center">
          <div className="text-xs text-gray-500">Consumo</div>
          <div className="text-xl font-extrabold text-amber-700">{fmtW(loadW)}</div>
        </div>
        <div className="panel text-center">
          <div className="text-xs text-gray-500">Bateria</div>
          <div className="text-xl font-extrabold text-purple-700">{fmtW(battW)}</div>
          {batterySavingsPerHourBRL!=null && (
            <div className="text-[11px] text-gray-600 mt-0.5">Economia: ≈ R$ {batterySavingsPerHourBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/h</div>
          )}
        </div>
        <div className="panel text-center">
          <div className="text-xs text-gray-500">Rede</div>
          <div className="text-xl font-extrabold text-rose-700">{fmtW(gridDerived)}</div>
          {costPerHourBRL!=null && (
            <div className="text-[11px] text-gray-600 mt-0.5">Gasto: ≈ R$ {costPerHourBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/h</div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {statusChips.length === 0 ? (
          <span className="text-sm muted">Sem fluxo relevante agora.</span>
        ) : statusChips.map((c, i)=>{
          const I = c.Icon; return (
            <span key={i} className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs border ${c.cls}`}>
              <I className="w-3.5 h-3.5"/> {c.label}
            </span>
          )
        })}
      </div>

      {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
    </div>
  )
}
