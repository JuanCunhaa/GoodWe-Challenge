export default function Relatorios(){
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="card">
        <div className="h2 mb-2">Relatórios</div>
        <div className="grid gap-3">
          {['Diário','Semanal','Mensal','Anual'].map((t,i)=>(
            <div key={i} className="panel flex items-center justify-between">
              <div className="text-gray-900 dark:text-gray-100">{t}</div>
              <button className="btn btn-danger">Exportar</button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h2 mb-2">Modelos</div>
        <ul className="list-disc pl-5 muted space-y-2">
          <li>CSV detalhado</li>
          <li>PDF executivo</li>
          <li>JSON para integrações</li>
        </ul>
      </div>
    </section>
  )
}
