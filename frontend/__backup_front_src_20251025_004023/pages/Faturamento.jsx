export default function Faturamento(){
  return (
    <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div className="card">
        <div className="h2 mb-2">Resumo</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="panel bg-brand/10 text-brand border-brand/30">
            <div className="text-xs">Economia</div>
            <div className="text-2xl font-bold">R$ 1.245</div>
          </div>
          <div className="panel bg-secondary/10 text-secondary border-secondary/30">
            <div className="text-xs">Custos</div>
            <div className="text-2xl font-bold">R$ 310</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="h2 mb-2">Pagamento</div>
        <button className="btn w-full">Atualizar cartão</button>
      </div>
      <div className="card">
        <div className="h2 mb-2">Notas</div>
        <p className="muted">Integre com ERP para conciliação.</p>
      </div>
    </section>
  )
}
