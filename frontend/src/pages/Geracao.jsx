import { useEffect, useMemo, useState } from 'react'
import { goodweApi, convertToBRL } from '../services/goodweApi.js'
import { energyService } from '../services/energyService.js'
import { Calendar, Download, RefreshCw, Zap, PlugZap, Eye, EyeOff } from 'lucide-react'

function parseHM(hm){ try{ const [h,m]=String(hm).split(':').map(Number); return h*60+m }catch{return null} }
function integrateSeries(xy){ if(!xy||xy.length<2) return 0; let kwh=0; for(let i=1;i<xy.length;i++){ const a=xy[i-1], b=xy[i]; const m0=parseHM(a.x), m1=parseHM(b.x); if(m0==null||m1==null) continue; const dtH=Math.max(0,(m1-m0)/60); const y=Number(a.y)||0; kwh+=(y*dtH)/1000; } return kwh; }
function integrateFiltered(xy, predicate){ if(!xy||xy.length<2) return 0; let kwh=0; for(let i=1;i<xy.length;i++){ const a=xy[i-1], b=xy[i]; const m0=parseHM(a.x), m1=parseHM(b.x); if(m0==null||m1==null) continue; const dtH=Math.max(0,(m1-m0)/60); const y=Number(a.y)||0; if(predicate(y)) kwh+=(Math.abs(y)*dtH)/1000; } return kwh; }

// Date helpers (string-based to avoid UTC shifts)
function toDateStr(d){ const dt = (d instanceof Date) ? d : new Date(String(d)+'T00:00:00'); const y=dt.getFullYear(); const m=String(dt.getMonth()+1).padStart(2,'0'); const day=String(dt.getDate()).padStart(2,'0'); return `${y}-${m}-${day}` }
function addDays(dateStr, days){ const dt=new Date(String(dateStr)+'T00:00:00'); dt.setDate(dt.getDate()+days); return toDateStr(dt) }
function weekBounds(dateStr){ const dt = new Date(String(dateStr)+'T00:00:00'); const day=(dt.getDay()+6)%7; const start = addDays(toDateStr(dt), -day); const end = addDays(start, 6); return { start, end }; }
function extractYMD(s){ const m = String(s||'').match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null }

function LineChart({ series=[], height=260, socXY=[], xLabels=[] }){
  const pad=28, width=680
  const colors={ PV:'#10b981', Load:'#f59e0b', Grid:'#ef4444' }
  const all=series.flatMap(s=>s.xy||[])
  const ys=all.map(p=>Number(p.y)||0)
  const minY=Math.min(0, ...ys)
  const maxY=Math.max(10, ...ys)
  const xs=(series[0]?.xy||[]).map(p=>p.x)
  const maxX=(xs.length-1)||1
  const mapX=(i)=> pad+(i/maxX)*(width-pad*2)
  const mapY=(y)=> {
    if (maxY === minY) return pad + (height-pad*2)/2
    const t=( (y - minY) / (maxY - minY) )
    return pad + (height - pad*2) * (1 - t)
  }

  const [hover, setHover] = useState(null) // { i, x }
  function onMove(e){
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = width / rect.width // css px -> svg units
    let xSvg = (e.clientX - rect.left) * scale
    xSvg = Math.max(pad, Math.min(width - pad, xSvg))
    const ratio = (xSvg - pad) / (width - pad*2)
    const i = Math.max(0, Math.min(maxX, Math.round(ratio * maxX)))
    setHover({ i, x: mapX(i) }) // trava a linha no ponto amostrado
  }

  const hoverPoints = useMemo(()=>{
    if(!hover) return null
    const base = series.map(s=>{
      const yVal = Number(s.xy?.[hover.i]?.y)
      if (!Number.isFinite(yVal)) return null
      return { label:s.label, x: mapX(hover.i), y: mapY(yVal), val: yVal, color: colors[s.label]||'#0ea5e9' }
    }).filter(Boolean)
    // SOC extra
    const socVal = Number(socXY?.[hover.i]?.y)
    if (Number.isFinite(socVal)) base.push({ label:'SOC(%)', x: mapX(hover.i), y: pad+2, val: socVal, color:'#8cc44d', isSOC:true })
    return base
  }, [hover, series, socXY])

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block"
      onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
      <g opacity={0.12}>{[0.25,0.5,0.75].map((t,i)=>(<line key={i} x1={pad} x2={width-pad} y1={pad + (height-pad*2)*t} y2={pad + (height-pad*2)*t} stroke="#94a3b8" strokeDasharray="4 4"/>))}</g>
      {(minY < 0 && maxY > 0) && (
        <line x1={pad} x2={width-pad} y1={mapY(0)} y2={mapY(0)} stroke="#64748b" strokeDasharray="4 4" opacity="0.35"/>
      )}
      {series.map((s,si)=>{ const pts=(s.xy||[]).map((p,i)=>`${mapX(i)},${mapY(Number(p.y)||0)}`).join(' '); return <polyline key={si} fill="none" stroke={colors[s.label]||'#0ea5e9'} strokeWidth="2" points={pts}/> })}

      {/* Hover markers */}
      {hover && (
        <g>
          <line x1={hover.x} x2={hover.x} y1={pad} y2={height-pad} stroke="#94a3b8" opacity="0.5"/>
          {hoverPoints?.map((p,idx)=> (
            <g key={idx}>
              <circle cx={p.x} cy={p.y} r="3.5" fill={p.color} stroke="#fff" strokeWidth="1"/>
            </g>
          ))}
          {/* Tooltip */}
          {hoverPoints && hoverPoints.length>0 && (()=>{
            const tipW = 240; const rowH = 20; const headerH = 32; const tipH = headerH + rowH*hoverPoints.length;
            const tipX = Math.min(width - pad - tipW, Math.max(pad, hover.x + 10));
            const tipY = pad + 8;
            return (
              <g transform={`translate(${tipX}, ${tipY})`}>
                <rect width={tipW} height={tipH} rx="10" fill="#0b1220" opacity="0.96" stroke="#334155"/>
                <text x="12" y="16" fontSize="12" fill="#e2e8f0" dominantBaseline="middle">{(xLabels?.[hover.i]) || xs[hover.i] || ''}</text>
                {hoverPoints.map((p,ii)=> (
                  <g key={ii} transform={`translate(0, ${headerH + ii*rowH})`}>
                    <rect x="12" y="-7" width="10" height="10" rx="2" fill={p.color}/>
                    <text x="28" y="0" fontSize="12" fill="#cbd5e1" dominantBaseline="middle">{fmtTooltip(p)}</text>
                  </g>
                ))}
              </g>
            );
          })()}
        </g>
      )}

      <g>{Object.entries(colors).map(([label,c],i)=>(<g key={label} transform={`translate(${pad + i*110}, ${height-pad+14})`}><rect width="10" height="10" rx="2" fill={c}/><text x="14" y="10" fontSize="11" fill="#64748b">{label}</text></g>))}</g>
    </svg>
  )
}

function fmtTooltip(p){
  if (!p) return ''
  const v = Number(p.val)
  if (p.label==='PV') return `PV (W): ${v.toLocaleString('pt-BR')}`
  if (p.label==='Load') return `Load (W): ${v.toLocaleString('pt-BR')}`
  // Battery removido da visualizaÃÂ§ÃÂ£o
  if (p.label==='Grid') return `Grid (W) (${v>=0?'Buy':'Sell'}): ${v.toLocaleString('pt-BR')}`
  if (p.label==='SOC(%)') return `SOC (%): ${v.toFixed(0)}`
  return `${p.label}: ${v}`
}

function Bars({ data=[], height=260 }){
  const width=680, pad=28
  const max=Math.max(1,...data.map(d=> d.gen||0, 0))
  const barW=Math.max(6, Math.floor((width - pad*2) / Math.max(1,data.length) - 4))
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block">
      <g opacity={0.12}>{[0.25,0.5,0.75].map((t,i)=>(<line key={i} x1={pad} x2={width-pad} y1={pad + (height-pad*2)*t} y2={pad + (height-pad*2)*t} stroke="#94a3b8" strokeDasharray="4 4"/>))}</g>
      {data.map((d,i)=>{ const x=pad + i*(barW+4); const h=(d.gen||0)/max*(height-pad*2); return (
        <g key={i}>
          <rect x={x} y={height-pad-h} width={barW} height={h} rx="3" fill="#10b981"/>
          <text x={x+barW/2} y={height-pad+12} textAnchor="middle" fontSize="10" fill="#64748b">{d.label}</text>
        </g>
      )})}
    </svg>
  )
}

export default function Geracao(){
  const [mode, setMode] = useState('DAY') // DAY | WEEK | MONTH | YEAR
  const [date, setDate] = useState(()=> new Date().toISOString().slice(0,10))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [series, setSeries] = useState([])
  // removed prefetch/backfill UI state
  const [agg, setAgg] = useState([])
  const [totals, setTotals] = useState({ gen:0, load:0, batt:0, grid:0 })
  const [revenueBRL, setRevenueBRL] = useState(0)
  const [enabled, setEnabled] = useState({ PV:true, Load:true, Grid:true })
  const [socXY, setSocXY] = useState([]) // sÃÂ©rie SOC (%) para tooltip

  useEffect(()=>{ refresh() }, [mode, date])

  // Auto-refresh: mais frequente no modo Dia; esparso nos agregados
  useEffect(()=>{
    const base = Number(import.meta.env.VITE_REFRESH_MS || 10000)
    const msDay = Number(import.meta.env.VITE_REFRESH_MS_GENERATION_DAY || base)
    const msAgg = Number(import.meta.env.VITE_REFRESH_MS_GENERATION_AGG || Math.max(30000, base))
    const ms = mode==='DAY' ? Math.max(5000, msDay) : Math.max(30000, msAgg)
    const id = setInterval(()=> { try{ refresh() } catch {} }, ms)
    const onFocus = ()=> { try{ refresh() } catch {} }
    const onVis = ()=> { if (document.visibilityState === 'visible') { try{ refresh() } catch {} } }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return ()=> { clearInterval(id); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis) }
  }, [mode, date])

  async function fetchDay(token, pwid, d){
    const r = await goodweApi.powerChartDay(token, pwid, d)
    if(String(r?.code)!=='0') throw new Error(r?.msg||'Falha ao consultar gráfico')
    const lines = r?.data?.lines||[]
    const byKey = Object.fromEntries(lines.map(l=>[l.key, l]))
    const sPV = byKey['PCurve_Power_PV']?.xy||[]
    const sLoad = byKey['PCurve_Power_Load']?.xy||[]
    const sBatt = byKey['PCurve_Power_Battery']?.xy||[]
    const sGrid = byKey['PCurve_Power_Meter']?.xy||[]
    const sSOC  = byKey['PCurve_Power_SOC']?.xy||[]
    return { series: [ {label:'PV',xy:sPV}, {label:'Load',xy:sLoad}, {label:'Grid',xy:sGrid} ], soc: sSOC, energy: { pv:integrateSeries(sPV), load:integrateSeries(sLoad), batt:integrateSeries(sBatt.map(p=>({...p,y:Math.abs(Number(p.y)||0)}))), grid:integrateSeries(sGrid.map(p=>({...p,y:Math.abs(Number(p.y)||0)}))), gridImp: integrateFiltered(sGrid, y=> y>0), gridExp: integrateFiltered(sGrid, y=> y<0), battDis: integrateFiltered(sBatt, y=> y>0), battChg: integrateFiltered(sBatt, y=> y<0) } }
  }

  async function refresh(){
    const token = localStorage.getItem('token')
    const user = JSON.parse(localStorage.getItem('user')||'null')
    if(!token || !user?.powerstation_id) return
    setLoading(true); setError('')
    try{
      if(mode==='DAY'){
        const { series, soc, energy } = await energyService.getDayCurvesCached(token, user.powerstation_id, date)
        setSeries(series)
        setSocXY(soc||[])
        setTotals({ gen:energy.pv, load:energy.load, batt:energy.batt, grid:energy.grid })
        setRevenueBRL(estimateRevenueBRL(energy.gridExp))
        setAgg([])
      } else if (mode==='WEEK'){
        // Semana: agregados diretos via DB (uma chamada), evita N requisições
        try {
          const end = toDateStr(new Date())
          const start = addDays(end, -6)
          const { items } = await energyService.getRangeAggregates({ token, plantId: user.powerstation_id, start, end })
          let list = []
          let sum = { gen:0, load:0, batt:0, grid:0, gridExp:0 }
          for (const it of (items||[])){
            const ds = it?.date || ''
            const e = it?.energy || {}
            const lbl = new Date(ds+'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })
            list.push({ label: lbl, ds, gen: Number(e.pv)||0, load: Number(e.load)||0, batt: Number(e.batt)||0, grid: Number(e.grid)||0 })
            sum = {
              gen:  sum.gen  + (Number(e.pv)||0),
              load: sum.load + (Number(e.load)||0),
              batt: sum.batt + (Number(e.batt)||0),
              grid: sum.grid + (Number(e.grid)||0),
              gridExp: sum.gridExp + (Number(e.gridExp)||0),
            }
          }
          setAgg(list)
          setTotals({ gen:sum.gen, load:sum.load, batt:sum.batt, grid:sum.grid })
          setSeries([])
          setRevenueBRL(estimateRevenueBRL(sum.gridExp))
          return; // short-circuit otimizado
        } catch {}
        // Semana baseada no mesmo carregamento do mÃªs: Ãºltimos 7 dias atÃ© hoje (inclusive)
        try {
          const end = toDateStr(new Date())
          const start = addDays(end, -6)
          const d0 = new Date(start + 'T00:00:00')
          let list = []
          let sum = { gen:0, load:0, batt:0, grid:0, gridExp:0 }
          for (let i = 0; i < 7; i++) {
            const d = new Date(d0); d.setDate(d0.getDate() + i)
            const ds = d.toISOString().slice(0,10)
            try {
              const { energy } = await energyService.getDayAggregatesCached(token, user.powerstation_id, ds)
              list.push({ label: d.toLocaleDateString('pt-BR', { weekday: 'short' }), ds, gen: energy.pv||0, load: energy.load||0, batt: energy.batt||0, grid: energy.grid||0 })
              sum = { gen: sum.gen + (energy.pv||0), load: sum.load + (energy.load||0), batt: sum.batt + (energy.batt||0), grid: sum.grid + (energy.grid||0), gridExp: sum.gridExp + (energy.gridExp||0) }
            } catch {}
          }
          setAgg(list)
          setTotals({ gen:sum.gen, load:sum.load, batt:sum.batt, grid:sum.grid })
          setSeries([])
          setRevenueBRL(estimateRevenueBRL(sum.gridExp))
          return; // não executar lÃ³gica antiga abaixo
        } catch {}
        // Usa ChartByPlant (range=2) e recorta seg..dom por string (YYYY-MM-DD)
        const { start, end } = weekBounds(date)
        let list=[]; let sum={gen:0,load:0,batt:0,grid:0,gridExp:0}
        try{
          const j = await goodweApi.chartByPlant(token, user.powerstation_id, { date: toDateStr(date), range: 2, chartIndexId: 8 })
          const lines = j?.data?.lines || []
          const norm = (s)=> String(s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'')
          const mapXY = (arr)=>{ const m=new Map(); (arr||[]).forEach(p=>{ const k=extractYMD(p?.x) || extractYMD(p?.label) || extractYMD(p?.date) || extractYMD(p); if(k) m.set(k, Number(p?.y)||0) }); return m }
          const by = {}; for (const l of lines){ by[norm(l.label||l.name)] = l.xy || [] }
          const genMap = mapXY(by['generationkwh']||by['generatekwh']||by['pvgenerationkwh']||by['pvkwh'])
          const loadMap= mapXY(by['consumptionkwh']||by['loadkwh'])
          const buyMap = mapXY(by['gridkwhbuy']||by['gridwkwhbuy']||by['gridbuykwh']||by['buykwh'])
          const sellMap= mapXY(by['gridkwhsell']||by['gridwkwhsell']||by['gridsellkwh']||by['sellkwh'])
          const inHouseMap = mapXY(by['inhousekwh']||by['selfusekwh'])
          const keys = Array.from(new Set([ ...genMap.keys(), ...loadMap.keys(), ...buyMap.keys(), ...sellMap.keys(), ...inHouseMap.keys() ])).filter(ds=> ds>=start && ds<=end).sort()
          for(const ds of keys){
            let gen = genMap.get(ds)
            const load= loadMap.get(ds) ?? 0
            const gridBuy = buyMap.get(ds)
            const gridSell= sellMap.get(ds)
            if (gen==null) gen = (inHouseMap.get(ds)||0) + (gridSell||0)
            const grid = (gridBuy||0) + (gridSell||0) || (gridBuy ?? gridSell ?? 0)
            const batt = Math.max(0, Math.abs((gen + (gridBuy||0)) - (load + (gridSell||0))))
            const lbl = new Date(ds+'T00:00:00').toLocaleDateString('pt-BR',{ weekday:'short' })
            list.push({ label: lbl, ds, gen, load, batt, grid })
            sum={ gen:sum.gen+gen, load:sum.load+load, batt:sum.batt+batt, grid:sum.grid+grid, gridExp:sum.gridExp+(gridSell||0) }
          }
        }catch{}
        // Fallback: se por algum motivo nÃÂ£o tiver dados, tenta dia-a-dia (mantido como ÃÂºltimo recurso)
        if (list.length===0){
          const { start } = weekBounds(date)
          const dsStart = new Date(start+'T00:00:00')
          for(let i=0;i<7;i++){
            const ds = new Date(dsStart); ds.setDate(dsStart.getDate()+i)
            const dsStr=ds.toISOString().slice(0,10)
            try{ const { energy } = await energyService.getDayAggregatesCached(token, user.powerstation_id, dsStr); list.push({label: ds.toLocaleDateString('pt-BR',{weekday:'short'}), ds: dsStr, gen:energy.pv, load:energy.load, batt:energy.batt, grid:energy.grid}); sum={gen:sum.gen+energy.pv,load:sum.load+energy.load,batt:sum.batt+energy.batt,grid:sum.grid+energy.grid, gridExp:sum.gridExp+energy.gridExp} }catch{}
          }
        }
        // Refinamento semanal: forÃ§a todos os dias a virem do Day (consistente com modo Dia)
        try{
          const up = new Map(list.map(r=> [r.ds, { ...r }]))
          let sum2={gen:0,load:0,batt:0,grid:0,gridExp:0}
          const dsList = Array.from(up.keys()).filter(Boolean).sort()
          for (const ds of dsList){
            try{
              const { energy } = await fetchDay(token, user.powerstation_id, ds)
              const row = up.get(ds) || { label: new Date(ds+'T00:00:00').toLocaleDateString('pt-BR',{weekday:'short'}), ds }
              row.gen = Number(energy.pv||0)
              row.load = Number(energy.load||0)
              row.grid = Number(energy.grid||0)
              row.batt = Number(energy.batt||0)
              up.set(ds, row)
              sum2={ gen:sum2.gen+row.gen, load:sum2.load+row.load, batt:sum2.batt+row.batt, grid:sum2.grid+row.grid, gridExp:sum2.gridExp+Number(energy.gridExp||0) }
            }catch{}
          }
          list = Array.from(up.values())
          sum = sum2
        }catch{}
        setAgg(list); setTotals({gen:sum.gen,load:sum.load,batt:sum.batt,grid:sum.grid}); setSeries([]); setRevenueBRL(estimateRevenueBRL(sum.gridExp))
      } else if (mode==='MONTH'){
        // Mês selecionado: agregados diretos via DB (uma chamada)
        try {
          const base = new Date(date)
          const y = base.getFullYear(), m = base.getMonth()
          const start = new Date(y, m, 1).toISOString().slice(0,10)
          const end = new Date(y, m+1, 0).toISOString().slice(0,10)
          const { items } = await energyService.getRangeAggregates({ token, plantId: user.powerstation_id, start, end })
          let list = []
          let sum = { gen:0, load:0, batt:0, grid:0, gridExp:0 }
          for (const it of (items||[])){
            const ds = it?.date || ''
            const e = it?.energy || {}
            const lbl = (ds||'').slice(8,10)
            list.push({ label: lbl, ds, gen: Number(e.pv)||0, load: Number(e.load)||0, batt: Number(e.batt)||0, grid: Number(e.grid)||0 })
            sum = {
              gen:  sum.gen  + (Number(e.pv)||0),
              load: sum.load + (Number(e.load)||0),
              batt: sum.batt + (Number(e.batt)||0),
              grid: sum.grid + (Number(e.grid)||0),
              gridExp: sum.gridExp + (Number(e.gridExp)||0),
            }
          }
          setAgg(list); setTotals(sum); setSeries([]); setRevenueBRL(estimateRevenueBRL(sum.gridExp))
          return; // short-circuit otimizado
        } catch {}
        // 30 dias dia-a-dia, sem ChartByPlant (atalho com retorno)
        {
          const base = new Date(date);
          let list = [];
          let sum = { gen:0, load:0, batt:0, grid:0, gridExp:0 };
          for (let i = 29; i >= 0; i--) {
            const d = new Date(base); d.setDate(base.getDate() - i);
            const ds = d.toISOString().slice(0,10);
            try {
              const { energy } = await energyService.getDayAggregatesCached(token, user.powerstation_id, ds);
              list.push({ label: ds.slice(8,10), ds, gen:energy.pv, load:energy.load, batt:energy.batt, grid:energy.grid });
              sum = {
                gen:  sum.gen  + (energy.pv   || 0),
                load: sum.load + (energy.load || 0),
                batt: sum.batt + (energy.batt || 0),
                grid: sum.grid + (energy.grid || 0),
                gridExp: sum.gridExp + (energy.gridExp || 0),
              };
            } catch {}
          }
          setAgg(list); setTotals(sum); setSeries([]); setRevenueBRL(estimateRevenueBRL(sum.gridExp));
          return;
        }
        const base=new Date(date); const y=base.getFullYear(), m=base.getMonth();
        // Tenta endpoint agregado rÃÂ¡pido (range=2: pontos diÃÂ¡rios). Usa exatamente as datas do JSON.
        let list=[]; let sum={gen:0,load:0,batt:0,grid:0,gridExp:0}
        try{
          const j = await goodweApi.chartByPlant(token, user.powerstation_id, { date: toDateStr(new Date(y,m,15)), range: 2, chartIndexId: 8 })
          const lines = j?.data?.lines || []
          const norm = (s)=> String(s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'')
          const mapXY = (arr)=>{ const m=new Map(); (arr||[]).forEach(p=>{ const k=extractYMD(p?.x) || extractYMD(p?.label) || extractYMD(p?.date) || extractYMD(p); if(k) m.set(k, Number(p?.y)||0) }); return m }
          const by = {}; for (const l of lines){ by[norm(l.label||l.name)] = l.xy || [] }
          const genMap = mapXY(by['generationkwh']||by['generatekwh']||by['pvgenerationkwh']||by['pvkwh'])
          const loadMap= mapXY(by['consumptionkwh']||by['loadkwh'])
          const buyMap = mapXY(by['gridkwhbuy']||by['gridwkwhbuy']||by['gridbuykwh']||by['buykwh'])
          const sellMap= mapXY(by['gridkwhsell']||by['gridwkwhsell']||by['gridsellkwh']||by['sellkwh'])
          const inHouseMap = mapXY(by['inhousekwh']||by['selfusekwh'])
          // Use as datas exatamente como vieram do JSON (uniÃÂ£o de chaves), ordenadas
          const keys = Array.from(new Set([ ...genMap.keys(), ...loadMap.keys(), ...buyMap.keys(), ...sellMap.keys(), ...inHouseMap.keys() ])).sort()
          for(const ds of keys){
            let gen = genMap.get(ds)
            const load= loadMap.get(ds) ?? 0
            const gridBuy = buyMap.get(ds)
            const gridSell= sellMap.get(ds)
            if (gen==null) gen = (inHouseMap.get(ds)||0) + (gridSell||0)
            const grid = (gridBuy||0) + (gridSell||0) || (gridBuy ?? gridSell ?? 0)
            const batt = Math.max(0, Math.abs((gen + (gridBuy||0)) - (load + (gridSell||0))))
            list.push({ label: ds.slice(8,10), ds, gen, load, batt, grid })
            sum={ gen:sum.gen+gen, load:sum.load+load, batt:sum.batt+batt, grid:sum.grid+grid, gridExp:sum.gridExp+gridSell }
          }
        } catch {}
        if (list.length===0){
          const dim=new Date(y,m+1,0).getDate();
          for(let d=1; d<=dim; d++){
            const ds=new Date(y,m,d).toISOString().slice(0,10)
            try{ const { energy } = await energyService.getDayAggregatesCached(token, user.powerstation_id, ds); list.push({label:String(d).padStart(2,'0'), ds, gen:energy.pv, load:energy.load, batt:energy.batt, grid:energy.grid}); sum={gen:sum.gen+energy.pv,load:sum.load+energy.load,batt:sum.batt+energy.batt,grid:sum.grid+energy.grid, gridExp:sum.gridExp+energy.gridExp} }catch{}
          }
        }
        setAgg(list); setTotals(sum); setSeries([]); setRevenueBRL(estimateRevenueBRL(sum.gridExp))
        // Refinamento mensal: forÃ§ar consistÃªncia com modo Dia usando cache local
        try {
          const token2 = localStorage.getItem('token');
          const user2 = JSON.parse(localStorage.getItem('user')||'null');
          if (token2 && user2?.powerstation_id) {
            const up = new Map(list.map(r=> [r.ds || (typeof r.label==='string' ? r.label : ''), { ...r }]));
            let sum2 = { gen:0, load:0, batt:0, grid:0, gridExp:0 };
            for (const [ds] of up) {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(ds||'')) continue;
              try{
                const { energy } = await energyService.getDayAggregatesCached(token2, user2.powerstation_id, ds);
                const row = up.get(ds);
                if (row) {
                  row.gen = Number(energy.pv||0);
                  row.load = Number(energy.load||0);
                  row.grid = Number(energy.grid||0);
                  row.batt = Number(energy.batt||0);
                  up.set(ds, row);
                  sum2 = { gen: sum2.gen + row.gen, load: sum2.load + row.load, batt: sum2.batt + row.batt, grid: sum2.grid + row.grid, gridExp: sum2.gridExp + Number(energy.gridExp||0) };
                }
              } catch {}
            }
            const newList = Array.from(up.values());
            setAgg(newList);
            setTotals(sum2);
            setRevenueBRL(estimateRevenueBRL(sum2.gridExp));
          }
        } catch {}
        // Refinamento (curvas diÃÂ¡rias) para MÃÂªs/Semana melhora bateria e venda
        const dayKeys = list.map(r=> r.ds || extractYMD(r.label)).filter(d=> /^\d{4}-\d{2}-\d{2}$/.test(d))
        if (mode==='WEEK' || mode==='MONTH'){
          await (async ()=>{
            const token2 = localStorage.getItem('token')
            const user2 = JSON.parse(localStorage.getItem('user')||'null')
            if(!token2 || !user2?.powerstation_id) return
            let sumSell=0
            let sum2={gen:0,load:0,batt:0,grid:0,gridExp:0}
            const up = new Map(list.map(r=> [r.ds||extractYMD(r.label), { ...r }]))
            for (const ds of dayKeys){
              try{
                const { energy } = await fetchDay(token2, user2.powerstation_id, ds)
                const row = up.get(ds) || { label: (ds||'').slice(8,10), ds }
                row.gen = Number(energy.pv||0)
                row.load = Number(energy.load||0)
                row.grid = Number(energy.grid||0)
                row.batt = Number(energy.batt||0)
                up.set(ds, row)
                sumSell += Number(energy.gridExp||0)
                sum2={ gen:sum2.gen+row.gen, load:sum2.load+row.load, batt:sum2.batt+row.batt, grid:sum2.grid+row.grid, gridExp:sum2.gridExp+Number(energy.gridExp||0) }
              }catch{}
            }
            const newList = Array.from(up.values())
            setAgg(newList)
            setTotals(sum2)
            setRevenueBRL(estimateRevenueBRL(sumSell))
          })()
        }
      } else {
        const base=new Date(date); const y=base.getFullYear(); const months=[...Array(12).keys()];
        let list=[]; let sum={gen:0,load:0,batt:0,grid:0,gridExp:0}
        try{
          const j = await goodweApi.chartByPlant(token, user.powerstation_id, { date: toDateStr(new Date(y,6,1)), range: 4, chartIndexId: 8 })
          const lines = j?.data?.lines || []
          const norm = (s)=> String(s||'')
            .toLowerCase().normalize('NFKD')
            .replace(/\p{Diacritic}/gu,'')
            .replace(/[^a-z0-9]+/g,'')
          const mapXY = (arr)=>{ const m=new Map(); (arr||[]).forEach(p=>{ const ds=extractYMD(p?.x) || extractYMD(p?.label) || extractYMD(p?.date) || extractYMD(p); if(ds) m.set(ds.slice(0,7), Number(p?.y)||0) }); return m }
          const by = {}; for (const l of lines){ by[norm(l.label||l.name)] = l.xy || [] }
          const genMap = mapXY(by['generationkwh']||by['generatekwh']||by['pvgenerationkwh']||by['pvkwh'])
          const loadMap= mapXY(by['consumptionkwh']||by['loadkwh'])
          const buyMap = mapXY(by['gridkwhbuy']||by['gridwkwhbuy']||by['gridbuykwh']||by['buykwh'])
          const sellMap= mapXY(by['gridkwhsell']||by['gridwkwhsell']||by['gridsellkwh']||by['sellkwh'])
          const inHouseMap = mapXY(by['inhousekwh']||by['selfusekwh'])
          const keys = Array.from(new Set([ ...genMap.keys(), ...loadMap.keys(), ...buyMap.keys(), ...sellMap.keys(), ...inHouseMap.keys() ])).sort()
          for (const key of keys){
            let gen = genMap.get(key)
            const load= loadMap.get(key) ?? 0
            const gridBuy= buyMap.get(key)
            const gridSell= sellMap.get(key)
            if (gen==null) gen = (inHouseMap.get(key)||0) + (gridSell||0)
            const grid= (gridBuy||0) + (gridSell||0) || (gridBuy ?? gridSell ?? 0)
            const batt= Math.max(0, Math.abs((gen + (gridBuy||0)) - (load + (gridSell||0))))
            list.push({ label: key, gen, load, batt, grid })
            sum={ gen:sum.gen+gen, load:sum.load+load, batt:sum.batt+batt, grid:sum.grid+grid, gridExp:sum.gridExp+gridSell }
          }
        } catch {}
        if (list.length===0){
          for(const m of months){
            const dim=new Date(y,m+1,0).getDate(); let mm={gen:0,load:0,batt:0,grid:0,gridExp:0}
            for(let d=1; d<=dim; d++){
              const ds=new Date(y,m,d).toISOString().slice(0,10)
              try{ const { energy } = await energyService.getDayAggregatesCached(token, user.powerstation_id, ds); mm={gen:mm.gen+energy.pv,load:mm.load+energy.load,batt:mm.batt+energy.batt,grid:mm.grid+energy.grid, gridExp:mm.gridExp+energy.gridExp} }catch{}
            }
            list.push({label:String(m+1).padStart(2,'0'), ...mm}); sum={gen:sum.gen+mm.gen,load:sum.load+mm.load,batt:sum.batt+mm.batt,grid:sum.grid+mm.grid, gridExp:sum.gridExp+mm.gridExp}
          }
        }
        // Trim inÃÂ­cio do ano atÃÂ© o primeiro mÃÂªs com dados > 0
        const firstIdx = list.findIndex(r => (Number(r.gen)||0) > 0 || (Number(r.load)||0) > 0 || (Number(r.grid)||0) > 0)
        if (firstIdx > 0){
          list = list.slice(firstIdx)
          const s = list.reduce((acc,r)=>({
            gen: acc.gen + (Number(r.gen)||0),
            load: acc.load + (Number(r.load)||0),
            batt: acc.batt + (Number(r.batt)||0),
            grid: acc.grid + (Number(r.grid)||0),
            gridExp: acc.gridExp
          }), { gen:0, load:0, batt:0, grid:0, gridExp: sum.gridExp })
          sum = s
        }
        setAgg(list); setTotals(sum); setSeries([]); setRevenueBRL(estimateRevenueBRL(sum.gridExp))
      }
    }catch(e){ setError(String(e.message||e)) }
    finally{ setLoading(false) }
  }

  function exportCSV(){
    const header='label,generation_kwh,consumption_kwh,grid_kwh\n'
    const rows=(mode==='DAY' ? (series[0]?.xy||[]).map((p,i)=>{
      const pv=series.find(s=>s.label==='PV')?.xy?.[i]?.y ?? ''
      const ld=series.find(s=>s.label==='Load')?.xy?.[i]?.y ?? ''
      const gr=series.find(s=>s.label==='Grid')?.xy?.[i]?.y ?? ''
      return `${p.x},${pv},${ld},${gr}`
    }) : agg.map(r=> `${r.label},${r.gen.toFixed(3)},${r.load.toFixed(3)},${r.grid.toFixed(3)}`)).join('\n')
    const blob=new Blob([header+rows],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`generation_${mode.toLowerCase()}_${date}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  function feedinTariffBRL(){
    const up=(s)=> (s||'').toUpperCase();
    const num=(v)=>{ const n=Number(v); return Number.isFinite(n)?n:0 };
    const region=up(import.meta.env.VITE_TARIFF_REGION || 'BRL');
    const feedin={ BRL:num(import.meta.env.VITE_FEEDIN_BRL_KWH), USD:num(import.meta.env.VITE_FEEDIN_USD_KWH), EUR:num(import.meta.env.VITE_FEEDIN_EUR_KWH), GBP:num(import.meta.env.VITE_FEEDIN_GBP_KWH), CNY:num(import.meta.env.VITE_FEEDIN_CNY_KWH) };
    let v = feedin[region] || 0;
    // Fallback: se feed-in nÃÂ£o definido, usa tarifa padrÃÂ£o da regiÃÂ£o
    if (!v){
      const tariff={ BRL:num(import.meta.env.VITE_TARIFF_BRL_KWH), USD:num(import.meta.env.VITE_TARIFF_USD_KWH), EUR:num(import.meta.env.VITE_TARIFF_EUR_KWH), GBP:num(import.meta.env.VITE_TARIFF_GBP_KWH), CNY:num(import.meta.env.VITE_TARIFF_CNY_KWH) };
      v = tariff[region] || tariff.BRL || 0;
    }
    if(region==='BRL') return v; return convertToBRL(v, region);
  }
  function estimateRevenueBRL(exportKWh){ const t=feedinTariffBRL(); return (exportKWh||0) * t }

  const summary = useMemo(()=>[
    { label:'GeraÃ§Ã£o', value: totals.gen, icon: Zap, cls:'text-emerald-700', key:'PV' },
    { label:'Consumo', value: totals.load, icon: PlugZap, cls:'text-amber-700', key:'Load' },
    { label:'Rede', value: totals.grid, icon: PlugZap, cls:'text-rose-700', key:'Grid' },
  ], [totals])

  // ConstróiÃÂ³i sÃÂ©ries de linhas para agregados (mÃÂªs/ano) a partir de agg
  const aggSeries = useMemo(()=>{
    if (!Array.isArray(agg) || agg.length===0) return []
    const toXY = (key)=> agg.map(r=> ({ x: String(r.label), y: Number(r[key]||0) }))
    return [
      { label:'PV', xy: toXY('gen') },
      { label:'Load', xy: toXY('load') },
      { label:'Grid', xy: toXY('grid') },
    ]
  }, [agg])

  // Tooltip header labels (full dates)
  const xLabels = useMemo(()=>{
    if (mode==='DAY'){
      const xs = series[0]?.xy || []
      return xs.map(p => `${date} ${p?.x ?? ''}`)
    }
    if (mode==='WEEK'){
      return (agg || []).map(r => r.ds || '')
    }
    if (mode==='MONTH'){
      return (agg || []).map(r => r.ds || (()=>{
        const base = new Date(date); const y=base.getFullYear(); const m=String(base.getMonth()+1).padStart(2,'0'); const d=String(r.label).padStart(2,'0');
        return `${y}-${m}-${d}`
      })())
    }
    return []
  }, [mode, date, series, agg])

  // removed handleBackfill UI (preload via Layout now)

  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="h2">GeraÃ§Ã£o de Energia</div>
          <div className="flex items-center gap-2">
            <button className={`btn ${mode==='DAY'?'btn-primary':''}`} onClick={()=>setMode('DAY')}>Dia</button>
            <button className={`btn ${mode==='WEEK'?'btn-primary':''}`} onClick={()=>setMode('WEEK')}>Semana</button>
            <button className={`btn ${mode==='MONTH'?'btn-primary':''}`} onClick={()=>setMode('MONTH')}>Mês</button>
            {/* Removido Ano */}
            <div className="panel flex items-center gap-2 py-1"><Calendar className="w-4 h-4 muted"/><input type="date" className="outline-none" value={date} onChange={e=>setDate(e.target.value)} /></div>
            <button className="btn" onClick={refresh}><RefreshCw className="w-4 h-4"/></button>
            <button className="btn" onClick={exportCSV}><Download className="w-4 h-4"/> Exportar</button>
            {(() => {
              // Hide after first seed per navegador/planta
              const token = localStorage.getItem('token');
              const user = JSON.parse(localStorage.getItem('user') || 'null');
              const meta = user?.powerstation_id ? energyService.getBackfillMeta(user.powerstation_id) : {};
              return null;
              return (
                <button className="btn" onClick={handleBackfill} disabled={backfilling} title="PrÃ©-carregar Ãºltimos dias no cache local">
                  <Download className="w-4 h-4"/>
                  {backfilling ? `PrÃ©-carregando ${backfillInfo.completed}/${backfillInfo.total}` : 'PrÃ©-carregar 365d'}
                </button>
              )
            })()}
          </div>
        </div>
        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {summary.map((s,i)=>{ const I=s.icon; const on = enabled[s.key]!==false; return (
            <div key={i} className="panel text-center">
              <div className="text-xs text-gray-600 inline-flex items-center gap-1"><I className={`w-3.5 h-3.5 ${s.cls}`}/> {s.label}</div>
              <div className={`text-xl font-extrabold ${s.cls}`}>{(s.value||0).toLocaleString('pt-BR',{maximumFractionDigits:2})} kWh</div>
              {s.key && (
                <button className="text-xs mt-1 inline-flex items-center gap-1 btn btn-ghost" onClick={()=> setEnabled(prev=> ({...prev, [s.key]: !on }))}>
                  {on ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                  {on ? 'Ocultar' : 'Mostrar'}
                </button>
              )}
            </div>
          )})}
        </div>
        {mode==='DAY' ? (
          <div className="panel">
            <LineChart series={series.filter(s=> enabled[s.label]!==false)} socXY={socXY} height={450} xLabels={xLabels}/>
          </div>
        ) : (
          <div className="panel">
            <LineChart series={aggSeries.filter(s=> enabled[s.label]!==false)} height={320} xLabels={xLabels}/>
          </div>
        )}
      </div>
    </section>
  )
}




