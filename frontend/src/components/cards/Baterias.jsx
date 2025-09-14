// src/components/cards/Baterias.jsx
import { Battery, Zap, Thermometer, Activity, ArrowLeft, Trash2, Plus } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../../state/AppStore.jsx";
import BatteryBar from "./BatteryBar.jsx";

const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp   = { y: -8, opacity: 0, transition: { duration: 0.18 } };

function healthMeta(pct) {
  if (pct >= 85) {
    return { label: "Excelente", textClass: "text-green-600", chipBg: "bg-green-50", chipText: "text-green-700" };
  } else if (pct >= 70) {
    return { label: "Moderada", textClass: "text-yellow-600", chipBg: "bg-yellow-50", chipText: "text-yellow-700" };
  }
  return { label: "Decadente", textClass: "text-red-600", chipBg: "bg-red-50", chipText: "text-red-700" };
}
function tempMeta(celsius) {
  if (celsius >= 45) return { textClass: "text-red-600", iconClass: "text-red-600" };
  if (celsius >= 35) return { textClass: "text-orange-600", iconClass: "text-orange-600" };
  return { textClass: "text-blue-600", iconClass: "text-blue-600" };
}

export default function Baterias() {
  const { batteries, addBattery, removeBatteryAt, hoursToHM } = useAppStore();

  const [view, setView] = useState({ type: "main", index: null }); // main | detail | add
  const [novoNome, setNovoNome] = useState("");

  const b = view.index != null ? batteries[view.index] : null;

  const autonomiaHours = b ? (b.soc * b.capacityKWh) / Math.max(0.1, b.avgLoadKW) : 0;
  const health = b ? healthMeta(b.healthPct) : healthMeta(0);
  const tmeta  = b ? tempMeta(b.tempC) : tempMeta(0);

  return (
    <div className="relative card p-6 rounded-2xl border border-blue-200 bg-blue-50 shadow overflow-hidden">
      {/* Header do card */}
      <div className="-mx-6 -mt-6 px-6 py-3 bg-blue-600 text-white rounded-t-2xl flex items-center gap-2 relative">
        {view.type !== "main" && (
          <button
            onClick={() => setView({ type: "main", index: null })}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-md hover:bg-white/10"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <Battery className="w-5 h-5" />
        <span className="text-lg font-bold">Baterias</span>
      </div>

      <div className="relative mt-4 min-h-[220px]">
        <AnimatePresence mode="wait">
          {view.type === "main" ? (
            <motion.div key="main" initial={{ opacity: 1 }} exit={exitUp} className="space-y-3">
              {batteries.map((bat, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                  onClick={() => setView({ type: "detail", index: i })}
                  className="group relative w-full h-12 rounded-xl bg-blue-600 text-white pl-4 pr-12 flex items-center justify-between active:scale-[.99]"
                >
                  {/* Nome à esquerda */}
                  <span className="truncate mr-3">{bat.nome}</span>

                  {/* BatteryBar no botão (contorno, % central, com tampinha) */}
                  <div className="pointer-events-none">
                    <BatteryBar
                      value={bat.soc}
                      outline
                      showPercent
                      
                    />
                  </div>

                  {/* Ícone à direita com raio se carregando */}
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    <span className="relative inline-block">
                      <Battery className="w-4 h-4 opacity-90" />
                      {bat.charging && (
                        <Zap className="w-3 h-3 text-yellow-400 absolute -top-2 -right-2 drop-shadow icon-wobble icon-wable" />
                      )}
                    </span>
                  </span>
                </motion.button>
              ))}

              <motion.button
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                onClick={() => setView({ type: "add", index: null })}
                className="mt-2 w-full h-12 rounded-xl bg-transparent border border-transparent hover:border-black/10 text-gray-600 hover:text-gray-900 transition font-medium inline-flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" /> Adicionar Bateria
              </motion.button>
            </motion.div>
          ) : view.type === "detail" ? (
            <motion.div
              key="detail"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: springIn }}
              exit={exitUp}
              className="space-y-4"
            >
              {/* Cabeçalho interno com nome */}
              <div className="rounded-xl bg-white/70 p-3 flex items-center gap-2">
                <Battery className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-gray-800">{b?.nome}</span>
              </div>

              {/* Bloco — Carga da bateria (com % maior) */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-gray-700">Carga da Bateria</span>
                  <span className="font-extrabold text-blue-700 text-3xl leading-none">
                    {(b.soc * 100).toFixed(0)}%
                  </span>
                </div>
                <BatteryBar value={b.soc} totalKWh={b.capacityKWh} />
                <div className="mt-2 flex justify-between text-xs text-gray-600">
                  <span>0%</span>
                  <span>{b.capacityKWh} kWh Total</span>
                  <span>100%</span>
                </div>
              </div>

              {/* NOVO — Autonomia Estimada (valor maior) */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">Autonomia Estimada</span>
                  <span className="font-extrabold text-blue-700 text-2xl leading-none">
                    {hoursToHM(autonomiaHours)}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  Baseada na carga atual ({(b.soc * 100).toFixed(0)}%) e consumo médio ({b.avgLoadKW} kW)
                </div>
              </div>

              {/* Saúde (cores dinâmicas) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className={`text-2xl font-extrabold ${health.textClass}`}>{b.healthPct}%</div>
                  <div className="text-xs text-gray-600">Saúde</div>
                  <div className={`mt-2 inline-flex px-3 py-1 rounded-full text-xs ${health.chipBg} ${health.chipText}`}>
                    {health.label}
                  </div>
                </div>

                {/* Temperatura (cores dinâmicas) */}
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className={`text-2xl font-extrabold ${tmeta.textClass}`}>
                    <Thermometer className={`inline w-4 h-4 -mt-1 mr-1 ${tmeta.iconClass}`} />
                    {b.tempC}°C
                  </div>
                  <div className="text-xs text-gray-600">Temperatura</div>
                </div>
              </div>

              {/* Vida útil */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center gap-2 font-semibold text-gray-800 mb-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Vida Útil
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Ciclos Utilizados</span>
                  <span className="font-semibold text-gray-800">
                    {b.cyclesUsed} / {b.cyclesTotal}
                  </span>
                </div>
                <div className="mt-2 w-full h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full bg-blue-600"
                    style={{ width: `${Math.min(100, (b.cyclesUsed / b.cyclesTotal) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Eficiência (apenas as duas métricas) */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="font-semibold text-gray-800 mb-2">Eficiência</div>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <span className="text-gray-600">Eficiência de Carga:</span>
                  <span className="text-right font-semibold text-gray-800">{b.effChargePct}%</span>
                  <span className="text-gray-600">Eficiência de Descarga:</span>
                  <span className="text-right font-semibold text-gray-800">{b.effDischargePct}%</span>
                </div>
              </div>

              {/* Deletar */}
              <div className="pt-1 flex justify-center">
                <button
                  onClick={() => {
                    if (window.confirm("Tem certeza que deseja deletar esta bateria?")) {
                      removeBatteryAt(view.index);
                      setView({ type: "main", index: null });
                    }
                  }}
                  className="h-10 px-4 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Deletar Dispositivo
                </button>
              </div>
            </motion.div>
          ) : (
            // ADICIONAR
            <motion.div
              key="add"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: springIn }}
              exit={exitUp}
              className="space-y-3"
            >
              <label className="block">
                <span className="text-sm text-gray-600">Nome da nova bateria</span>
                <input
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  className="mt-1 w-full h-11 rounded-lg border px-3"
                  placeholder="Ex.: Bateria de Backup"
                />
              </label>
              <div className="pt-3 flex justify-end gap-2">
                <button
                  onClick={() => setView({ type: "main", index: null })}
                  className="h-10 px-4 rounded-lg bg-white border"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const nome = novoNome.trim();
                    if (nome) {
                      addBattery(nome);
                      setNovoNome("");
                      setView({ type: "main", index: null });
                    }
                  }}
                  className="h-10 px-4 rounded-lg bg-blue-600 text-white"
                >
                  Adicionar
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
