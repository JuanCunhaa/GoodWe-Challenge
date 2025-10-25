export default function Configuracoes(){
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="card">
        <div className="h2 mb-2">Preferências</div>
        <form className="grid gap-4">
          <div><label className="muted text-sm">Nome da Planta</label><input className="panel mt-1 w-full" placeholder="Unidade A" /></div>
          <div><label className="muted text-sm">Timezone</label><select className="panel mt-1 w-full"><option>America/Sao_Paulo</option><option>UTC</option></select></div>
          <button className="btn btn-primary w-fit">Salvar</button>
        </form>
      </div>
      <div className="card">
        <div className="h2 mb-2">Integrações</div>
        <div className="panel">Conectar SEMS / webhooks.</div>
      </div>
    </section>
  )
}
