export default function Admin(){
  return (
    <section className="grid gap-6">
      <div className="card">
        <div className="h2 mb-2">Admin de Usuários</div>
        <div className="grid md:grid-cols-3 gap-4">
          {['Operador','Técnico','Administrador'].map((r,i)=>(
            <div key={i} className="panel">
              <div className="text-xs muted">Perfil</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{r}</div>
              <button className="btn mt-3">Gerenciar</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
