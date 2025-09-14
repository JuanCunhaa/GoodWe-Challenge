import Rentabilidade from '../components/cards/Rentabilidade.jsx'
import Geradores from '../components/cards/Geradores.jsx'
import Baterias from '../components/cards/Baterias.jsx'
import CarregadoresVeiculos from '../components/cards/CarregadoresVeiculos.jsx'
import Alexa from '../components/cards/Alexa.jsx'

export default function Dashboard() {
  return (
    <section className="grid gap-6 sm:grid-cols-6 lg:grid-cols-12">
      <div className="lg:col-span-12">
        <Rentabilidade />
      </div>
      <div className="sm:col-span-6 lg:col-span-6">
        <Geradores />
      </div>
      <div className="sm:col-span-6 lg:col-span-6">
        <Baterias />
      </div>
      <div className="sm:col-span-6 lg:col-span-6">
        <CarregadoresVeiculos />
      </div>
      <div className="sm:col-span-6 lg:col-span-6">
        <Alexa />
      </div>
    </section>
  )
}
