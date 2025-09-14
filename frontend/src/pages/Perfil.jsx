export default function Perfil(){
  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="card">
        <div className="h2 mb-2">Operador</div>
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full bg-brand/20 border border-brand/30" />
          <div>
            <div className="font-semibold text-gray-900 dark:text-gray-100">GoodWee Admin</div>
            <div className="muted text-sm">admin@goodwee.local</div>
          </div>
        </div>
        <button className="btn mt-4">Editar</button>
      </div>
      <div className="card">
        <div className="h2 mb-2">Atividade recente</div>
        <ul className="space-y-2">
          <li className="panel">Atualizado limite de alerta</li>
          <li className="panel">Exportado relatório mensal</li>
          <li className="panel">Adicionado inversor GW-005</li>
        </ul>
      </div>
    </section>
  )
}
