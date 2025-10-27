export default function Manutencao(){
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Plano de Manutenção</div>
        <table className="w-full text-sm">
          <thead className="muted text-left">
            <tr><th className="py-2">Atividade</th><th>Frequência</th><th>Responsável</th><th>Status</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100/70 dark:divide-gray-800/70">
            {[
              {t:'Limpeza de painéis', f:'Mensal', r:'Time Externo', s:'Agendado'},
              {t:'Checagem de cabos', f:'Trimestral', r:'Técnico local', s:'Pendente'},
              {t:'Atualização firmware', f:'Semestral', r:'Engenharia', s:'Concluído'},
            ].map((i,idx)=>(
              <tr key={idx} className="text-gray-900 dark:text-gray-100">
                <td className="py-3">{i.t}</td>
                <td>{i.f}</td>
                <td>{i.r}</td>
                <td><span className="px-2 py-1 rounded-lg text-xs bg-brand/10 text-brand border border-brand/30">{i.s}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
