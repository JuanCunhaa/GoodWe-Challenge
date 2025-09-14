// src/components/cards/CarregadoresVeiculos.jsx
import {
  Plug,
  Car as CarIcon,
  Zap,
  ArrowLeft,
  Trash2,
  Plus,
  CheckCircle2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { AlertBadge, AlertsPanel } from "../ui/Alerts.jsx";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../../state/AppStore.jsx";
import BatteryBar from "./BatteryBar.jsx";

const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp = { y: -8, opacity: 0, transition: { duration: 0.18 } };

export default function CarregadoresVeiculos() {
  const {
    chargers,
    vehicles,
    addCharger,
    removeChargerAt,
    updateCharger,
    addVehicle,
    removeVehicleAt,
    updateVehicle,
    chargerAlerts,
    refreshChargerAlerts,
    vehicleAlerts,
    refreshVehicleAlerts,
  } = useAppStore();

  const chargersSafe = chargers ?? [];
  const vehiclesSafe = vehicles ?? [];

  // main | charger-detail | vehicle-detail | add-charger | add-vehicle
  const [view, setView] = useState({ type: "main", index: null, group: null });
  const isMain = view.type === "main";

  const selectedCharger =
    view.group === "charger" && view.index != null ? chargersSafe[view.index] : null;

  const selectedVehicle =
    view.group === "vehicle" && view.index != null ? vehiclesSafe[view.index] : null;

  useEffect(() => {
    if (view.type === "charger-detail" && view.index != null) {
      refreshChargerAlerts(view.index);
    }
    if (view.type === "vehicle-detail" && view.index != null) {
      refreshVehicleAlerts(view.index);
    }
  }, [view, refreshChargerAlerts, refreshVehicleAlerts]);

  return (
    <div className="relative card p-6 rounded-2xl border border-purple-200 bg-purple-50 shadow overflow-hidden">
      {/* header fixo do card */}
      <div className="-mx-6 -mt-6 px-6 py-3 bg-purple-600 text-white rounded-t-2xl flex items-center gap-2 relative">
        {!isMain && (
          <button
            onClick={() => setView({ type: "main", index: null, group: null })}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-md hover:bg-white/10"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <Plug className="w-5 h-5" />
        <span className="text-lg font-bold">Carregadores &amp; Veículos</span>
      </div>

      <div className="relative mt-4 min-h-[240px]">
        <AnimatePresence mode="wait">
          {isMain ? (
            <motion.div key="main" initial={{ opacity: 1 }} exit={exitUp} className="space-y-6">
              {/* ---- Lista de Carregadores ---- */}
              <section>
                <h4 className="mb-2 text-sm font-semibold text-purple-900/80">Carregadores</h4>
                <div className="space-y-3">
                  {chargersSafe.map((c, i) => (
                    <motion.button
                      key={`c-${i}`}
                      whileHover={{ scale: 1.02 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                      onClick={() =>
                        setView({ type: "charger-detail", index: i, group: "charger" })
                      }
                      className="group relative w-full h-12 rounded-xl bg-purple-600 text-white pl-4 pr-12 flex items-center justify-between active:scale-[.99]"
                    >
                      <span className="truncate">{c.nome}</span>

                      {/* ícone à direita (Plug). Exibe raio acima se em uso + badge de alerta */}
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        <span className="relative inline-block">
                          <Plug className="w-4 h-4 opacity-90" />
                          {c.inUse && (
                            <Zap className="w-3 h-3 text-yellow-400 absolute -top-2 -right-2 drop-shadow icon-wobble icon-wable" />
                          )}
                          <span className="absolute -top-1 -right-1">
                            <AlertBadge count={(chargerAlerts?.[i]?.length) || 0} />
                          </span>
                        </span>
                      </span>
                    </motion.button>
                  ))}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                    onClick={() =>
                      setView({ type: "add-charger", index: null, group: "charger" })
                    }
                    className="mt-2 w-full h-12 rounded-xl bg-transparent border border-transparent hover:border-black/10 text-gray-600 hover:text-gray-900 transition font-medium inline-flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" /> Adicionar Carregador
                  </motion.button>
                </div>
              </section>

              {/* ---- Lista de Veículos ---- */}
              <section>
                <h4 className="mb-2 text-sm font-semibold text-purple-900/80">Veículos</h4>
                <div className="space-y-3">
                  {vehiclesSafe.map((v, i) => (
                    <motion.button
                      key={`v-${i}`}
                      whileHover={{ scale: 1.02 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                      onClick={() =>
                        setView({ type: "vehicle-detail", index: i, group: "vehicle" })
                      }
                      className="group relative w-full h-12 rounded-xl bg-indigo-500 text-white pl-4 pr-12 flex items-center justify-between active:scale-[.99]"
                    >
                      <span className="truncate">{v.nome}</span>

                      {/* Bateria com contorno e % central no botão */}
                      <BatteryBar outline showPercent cap value={v.soc} />

                      {/* Ícone do carro à direita com raio se carregando + badge */}
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        <span className="relative inline-block">
                          <CarIcon className="w-4 h-4 opacity-90" />
                          {v.charging && (
                            <Zap className="w-3 h-3 text-yellow-400 absolute -top-2 -right-2 drop-shadow icon-wobble icon-wable" />
                          )}
                          <span className="absolute -top-1 -right-1">
                            <AlertBadge count={(vehicleAlerts?.[i]?.length) || 0} />
                          </span>
                        </span>
                      </span>
                    </motion.button>
                  ))}

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                    onClick={() =>
                      setView({ type: "add-vehicle", index: null, group: "vehicle" })
                    }
                    className="mt-2 w-full h-12 rounded-xl bg-transparent border border-transparent hover:border-black/10 text-gray-600 hover:text-gray-900 transition font-medium inline-flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" /> Adicionar Veículo
                  </motion.button>
                </div>
              </section>
            </motion.div>
          ) : view.type === "charger-detail" ? (
            /* --------- DETALHE: CARREGADOR --------- */
            <motion.div
              key="charger-detail"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: springIn }}
              exit={exitUp}
              className="space-y-4"
            >
              {/* Cabeçalho interno */}
              <div className="rounded-xl bg-white/70 p-3 flex items-center gap-2">
                <Plug className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-gray-800">{selectedCharger?.nome}</span>
              </div>

              {/* Próximo agendamento (editável) */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">Próximo Agendamento</span>
                  <input
                    type="time"
                    value={selectedCharger?.nextAt ?? "22:00"}
                    onChange={(e) => updateCharger(view.index, { nextAt: e.target.value })}
                    className="h-10 w-28 rounded-md border px-2 text-sm"
                  />
                </div>
                <div className="mt-2 text-sm text-gray-600">Carregamento programado</div>
              </div>

              {/* Consumo hoje */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">Consumo Hoje</span>
                  <span className="font-semibold text-purple-700">
                    {selectedCharger?.consumoHojeKWh?.toFixed(1) ?? 0} kWh
                  </span>
                </div>
                <div className="mt-2 text-sm text-gray-600 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  Energia consumida nas últimas 24h
                </div>
              </div>

              {/* Potência máxima */}
              <div className="rounded-xl bg-white/85 p-4 text-center">
                <div className="text-2xl font-extrabold text-purple-700">
                  {selectedCharger?.maxKW?.toFixed(1) ?? 0} kW
                </div>
                <div className="text-xs text-gray-600">Potência Máxima</div>
              </div>

              <AlertsPanel items={chargerAlerts?.[view.index] || []} />

              {/* Deletar */}
              <div className="pt-1 flex justify-center">
                <button
                  onClick={() => {
                    if (window.confirm("Tem certeza que deseja deletar este carregador?")) {
                      removeChargerAt(view.index);
                      setView({ type: "main", index: null, group: null });
                    }
                  }}
                  className="h-10 px-4 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Deletar Dispositivo
                </button>
              </div>
            </motion.div>
          ) : view.type === "vehicle-detail" ? (
            /* --------- DETALHE: VEÍCULO --------- */
            <motion.div
              key="vehicle-detail"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: springIn }}
              exit={exitUp}
              className="space-y-4"
            >
              {/* Cabeçalho interno */}
              <div className="rounded-xl bg-white/70 p-3 flex items-center gap-2">
                <CarIcon className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold text-gray-800">{selectedVehicle?.nome}</span>

                {selectedVehicle?.connected && (
                  <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Conectado
                  </span>
                )}
              </div>

              {/* Nível de bateria */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-700">Nível da Bateria</span>
                  <span className="font-semibold text-indigo-700">
                    {((selectedVehicle?.soc ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <BatteryBar value={selectedVehicle?.soc ?? 0} height={10} className="mt-1" />
              </div>

              {/* Autonomia estimada */}
              <div className="rounded-xl bg-white/85 p-6 text-center">
                <div className="text-3xl font-extrabold text-indigo-700">
                  {selectedVehicle?.rangeKm ?? 0} km
                </div>
                <div className="text-sm text-gray-600 mt-1">Baseado na carga atual</div>
              </div>

              <AlertsPanel items={vehicleAlerts?.[view.index] || []} />

              {/* Deletar */}
              <div className="pt-1 flex justify-center">
                <button
                  onClick={() => {
                    if (window.confirm("Tem certeza que deseja deletar este veículo?")) {
                      removeVehicleAt(view.index);
                      setView({ type: "main", index: null, group: null });
                    }
                  }}
                  className="h-10 px-4 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 inline-flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Deletar Dispositivo
                </button>
              </div>
            </motion.div>
          ) : view.type === "add-charger" ? (
            <AddForm
              key="add-charger"
              colorBtn="bg-purple-600"
              placeholder="Ex.: Carregador Garagem"
              onCancel={() => setView({ type: "main", index: null, group: null })}
              onAdd={(nome) => {
                addCharger(nome);
                setView({ type: "main", index: null, group: null });
              }}
            />
          ) : (
            <AddForm
              key="add-vehicle"
              colorBtn="bg-indigo-600"
              placeholder="Ex.: BMW X6"
              onCancel={() => setView({ type: "main", index: null, group: null })}
              onAdd={(nome) => {
                addVehicle(nome);
                setView({ type: "main", index: null, group: null });
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- Form genérico de adicionar ---------------- */
function AddForm({ onCancel, onAdd, placeholder, colorBtn }) {
  const [nome, setNome] = useState("");
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: springIn }}
      exit={exitUp}
      className="space-y-3"
    >
      <label className="block">
        <span className="text-sm text-gray-600">Nome</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="mt-1 w-full h-11 rounded-lg border px-3"
          placeholder={placeholder}
        />
      </label>
      <div className="pt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="h-10 px-4 rounded-lg bg-white border">
          Cancelar
        </button>
        <button
          onClick={() => {
            const n = nome.trim();
            if (n) onAdd(n);
          }}
          className={`h-10 px-4 rounded-lg text-white ${colorBtn}`}
        >
          Adicionar
        </button>
      </div>
    </motion.div>
  );
}
