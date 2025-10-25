export default function Live(){
  return (
    <section className="grid gap-6">
      <div className="grid md:grid-cols-3 gap-4">
        {['Tensão', 'Corrente', 'Frequência'].map((l,i)=>(
          <div key={i} className="card">
            <div className="text-xs muted">{l}</div>
            <div className="text-4xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">{[220, 15.4, '60Hz'][i]}</div>
            <div className="mt-3 h-12 skeleton"></div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="h2 mb-2">Eventos em tempo real</div>
        <ul className="space-y-2">
          {Array.from({length:6}).map((_,i)=>(<li key={i} className="panel">[{new Date().toLocaleTimeString()}] Evento #{i+1}</li>))}
        </ul>
      </div>
    </section>
  )
}
