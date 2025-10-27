import {
  Sun,
  Moon,
  Zap,
  ArrowLeft,
  Trash2,
  Plus,
} from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../../state/AppStore.jsx";
import { AlertBadge, AlertsPanel } from "../ui/Alerts.jsx";

const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp   = { y: -8, opacity: 0, transition: { duration: 0.18 } };

export default function Geradores() {
  const {
    generators,
    addGenerator,
    removeGeneratorAt,
    updateGenerator,
    generatorAlerts,
    refreshGeneratorAlerts,
  } = useAppStore();

  const generatorsSafe = generators ?? [];

  // main | detail | add
  const [view, setView] = useState({ type: "main", index: null });

  const isMain = view.type === "main";
  const gSel   = view.index != null ? generatorsSafe[view.index] : null;

  useEffect(() => {
    if (view.type === "detail" && view.index != null) {
      refreshGeneratorAlerts(view.index);
    }
  }, [view, refreshGeneratorAlerts]);

  return (
    <div className="relative card p-6 rounded-2xl border border-orange-200 bg-orange-50 shadow overflow-hidden">
      {/* header fixo */}
      <div className="-mx-6 -mt-6 px-6 py-3 bg-orange-600 text-white rounded-t-2xl flex items-center gap-2 relative">
        {!isMain && (
          <button
            onClick={() => setView({ type: "main", index: null })}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-md hover:bg-white/10"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <Sun className="w-5 h-5" />
        <span className="text-lg font-bold">Geradores</span>
      </div>

      <div className="relative mt-4 min-h-[220px]">
        <AnimatePresence mode="wait">
          {isMain ? (
            <motion.div key="main" initial={{ opacity: 1 }} exit={exitUp} className="space-y-3">
              {(generatorsSafe).map((g, i) => {
                const produzindo = (g.kw ?? 0) > 0;
                return (
                  <motion.button
                    key={`g-${i}`}
                    whileHover={{ scale: 1.02, rotate: 0.001 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                    onClick={() => setView({ type: "detail", index: i })}
                    className="group relative w-full h-12 rounded-xl bg-orange-600 text-white pl-4 pr-12 flex items-center justify-between active:scale-[.99] overflow-hidden"
                  >
                    {/* Nome */}
                    <span className="truncate">{g.nome}</span>

                    {/* Ícone direita: sol (produção) ou lua (parado) + badge alerta */}
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      <span className="relative inline-block">
                        {produzindo ? (
                          <Sun className="w-4 h-4 opacity-90 group-hover:rotate-180 transition-transform duration-300" />
                        ) : (
                          /* LUA faz o wobble curtinho ao hover */
                          <Moon className="w-4 h-4 opacity-90 icon-wobble icon-wable" />
                        )}
                        <span className="absolute -top-1 -right-1">
                          <AlertBadge count={(generatorAlerts?.[i]?.length) || 0} />
                        </span>
                      </span>
                    </span>
                  </motion.button>
                );
              })}

              {/* Adicionar */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                onClick={() => setView({ type: "add", index: null })}
                className="mt-2 w-full h-12 rounded-xl bg-transparent border border-transparent hover:border-black/10 text-gray-600 hover:text-gray-900 transition font-medium inline-flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" /> Adicionar Gerador
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
              {/* Cabeçalho interno */}
              <div className="rounded-xl bg-white/70 p-3 flex items-center gap-2">
                <Sun className="w-4 h-4 text-orange-600" />
                <span className="font-semibold text-gray-800">{gSel?.nome}</span>
              </div>

              {/* Bloco 1 — Produção (kWh/dia / kWp / R$) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className="text-2xl font-extrabold text-orange-700">
                    {(gSel?.kwhDia ?? 0).toFixed(1)} kWh/dia
                  </div>
                  <div className="text-xs text-gray-600">Produção diária</div>
                </div>
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className="text-2xl font-extrabold text-orange-700">
                    {(gSel?.kwp ?? 0).toFixed(1)} kWp
                  </div>
                  <div className="text-xs text-gray-600">Potência Pico</div>
                </div>
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className="text-2xl font-extrabold text-orange-700">
                    R$ {(gSel?.rDia ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-600">Rendimento diário</div>
                </div>
                <div className="rounded-xl bg-white/85 p-4 text-center">
                  <div className="text-2xl font-extrabold text-orange-700">
                    R$ {(gSel?.rMes ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-600">Rendimento mensal</div>
                </div>
              </div>

              {/* Bloco 5 — Alertas (via API externa futura) */}
              <AlertsPanel items={generatorAlerts?.[view.index] || []} />

              {/* Deletar */}
              <div className="pt-1 flex justify-center">
                <button
                  onClick={() => {
                    if (window.confirm("Tem certeza que deseja deletar este gerador?")) {
                      removeGeneratorAt(view.index);
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
            /* ADICIONAR */
            <motion.div
              key="add"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: springIn }}
              exit={exitUp}
              className="space-y-3"
            >
              <label className="block">
                <span className="text-sm text-gray-600">Nome do gerador</span>
                <input
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const nome = e.currentTarget.value.trim();
                      if (nome) {
                        addGenerator(nome);
                        setView({ type: "main", index: null });
                      }
                    }
                  }}
                  className="mt-1 w-full h-11 rounded-lg border px-3"
                  placeholder="Ex.: Painel Cobertura"
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
                    const input = document.querySelector("input[placeholder='Ex.: Painel Cobertura']");
                    const nome = input?.value.trim();
                    if (nome) {
                      addGenerator(nome);
                      setView({ type: "main", index: null });
                    }
                  }}
                  className="h-10 px-4 rounded-lg bg-orange-600 text-white"
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
