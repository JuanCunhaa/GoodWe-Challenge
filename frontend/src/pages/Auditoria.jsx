export default function Auditoria(){
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Logs de Auditoria</div>
        <ul className="space-y-2 text-sm">
          {Array.from({length:10}).map((_,i)=>(
            <li key={i} className="panel">#{i+1} • {new Date().toLocaleString()} • Ação de segurança</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
