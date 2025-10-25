export default function Fluxo(){
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Fluxo de Energia (conceitual)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-4">
          <div className="panel text-center">
            <div className="text-xs muted">Painéis</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">+12 kWh</div>
          </div>
          <div className="panel text-center">
            <div className="text-xs muted">Bateria</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">+4 kWh</div>
          </div>
          <div className="panel text-center">
            <div className="text-xs muted">Rede</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">-2 kWh</div>
          </div>
        </div>
        <div className="mt-6 h-48 skeleton"></div>
      </div>
    </section>
  )
}
