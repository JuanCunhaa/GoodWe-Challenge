export default function WidgetSpark({ label='Hoje', points=24 }){
  const data = Array.from({length: points}, () => Math.round(40+Math.random()*60))
  const max = Math.max(...data)
  return (
    <div className="panel">
      <div className="text-xs muted">{label}</div>
      <div className="mt-2 h-12 flex items-end gap-1">
        {data.map((v,i)=> (
          <div key={i} className="w-2 rounded-lg bg-brand/50" style={{height:`${(v/max)*100}%`}} />
        ))}
      </div>
    </div>
  )
}
