export default function Geracao(){
  return (
    <section className="grid gap-6">
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="h2 mb-2">Curva diária</div>
          <div className="skeleton h-60"></div>
        </div>
        <div className="card">
          <div className="h2 mb-2">Mensal</div>
          <div className="skeleton h-60"></div>
        </div>
      </div>
    </section>
  )
}
