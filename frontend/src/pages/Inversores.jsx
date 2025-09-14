export default function Inversores(){
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Lista de Inversores</div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-left">
              <tr><th className="py-2">ID</th><th>Modelo</th><th>Local</th><th>Status</th><th>Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100/70 dark:divide-gray-800/70">
              {Array.from({length:8}).map((_,i)=>(
                <tr key={i} className="text-gray-900 dark:text-gray-100">
                  <td className="py-3">GW-{100+i}</td>
                  <td>GoodWee X-{3000+i}</td>
                  <td>Unidade {(i%3)+1}</td>
                  <td><span className="px-2 py-1 rounded-lg text-xs bg-brand/10 text-brand border border-brand/30">Ativo</span></td>
                  <td><button className="btn">Detalhes</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
