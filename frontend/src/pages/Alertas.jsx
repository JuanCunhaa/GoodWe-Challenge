export default function Alertas(){
  const items = [
    {title:'Tensão fora do intervalo', level:'Alto', code:'GW-A12'},
    {title:'Perda de comunicação', level:'Médio', code:'GW-C07'},
    {title:'Temperatura elevada', level:'Alto', code:'GW-T21'},
  ]
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Alertas Ativos</div>
        <div className="rounded-2xl border border-gray-100/60 dark:border-gray-800/60 divide-y divide-gray-100/60 dark:divide-gray-800/60">
          {items.map((a, i)=>(
            <div key={i} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{a.title}</div>
                <div className="text-xs muted">Código: {a.code}</div>
              </div>
              <span className="px-2 py-1 rounded-lg text-xs bg-secondary/10 text-secondary border border-secondary/30">{a.level}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-3">
          <button className="btn btn-danger">Reconhecer tudo</button>
          <button className="btn">Exportar</button>
        </div>
      </div>
    </section>
  )
}
