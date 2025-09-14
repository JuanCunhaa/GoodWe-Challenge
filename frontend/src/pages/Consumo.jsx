export default function Consumo(){
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Consumo por zona</div>
        <div className="skeleton h-60"></div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {['Iluminação','Climatização','Processos'].map((t,i)=>(
          <div key={i} className="panel">
            <div className="text-xs muted">{t}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{[2.4,4.1,3.2][i]} kWh</div>
          </div>
        ))}
      </div>
    </section>
  )
}
