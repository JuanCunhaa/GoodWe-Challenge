import Rentabilidade from '../components/cards/Rentabilidade.jsx'
import ResumoEnergia from '../components/cards/ResumoEnergia.jsx'
import ClimaTempo from '../components/cards/ClimaTempo.jsx'
import Baterias from '../components/cards/Baterias.jsx'
import Alexa from '../components/cards/Alexa.jsx'

export default function Dashboard() {
  return (
    <section className="grid gap-6 sm:grid-cols-6 lg:grid-cols-12">
      <div className="lg:col-span-12">
        <Rentabilidade />
      </div>
      <div className="lg:col-span-12">
        <ResumoEnergia />
      </div>
      <div className="sm:col-span-6 lg:col-span-6">
        <ClimaTempo />
      </div>
      <div className="sm:col-span-6 lg:col-span-6">
        <Baterias />
      </div>
    </section>
  )
}
