import { TrendingUp, Calculator, ArrowLeft } from "lucide-react";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../../state/AppStore.jsx";

const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp   = { y: -8, opacity: 0, transition: { duration: 0.18 } };

function Progress({ value = 0 }) {
  return (
    <div className="w-full h-3 rounded-full bg-white/70 overflow-hidden">
      <div
        className="h-full bg-green-600"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export default function Rentabilidade() {
  const [view, setView] = useState("main"); // 'main' | 'detail'
  const { generators, totals } = useAppStore();

  // “valor que já possui (R$)” = soma dos R$ / mês de todos os geradores
  const credits = totals.totalRMes;           // <- soma rMes
  const roiTarget = 45000;                    // alvo de retorno (exemplo)
  const monthsLeft = useMemo(() => {
    // estimativa simplificada: alvo / (R$/mês) -> meses restantes
    const perMonth = totals.totalRMes || 1;   // evita divisão por zero
    return Math.max(0, Math.ceil((roiTarget - credits) / perMonth));
  }, [roiTarget, credits, totals.totalRMes]);
  const percent = (credits / roiTarget) * 100;

  return (
    <div className="relative card p-6 rounded-2xl border border-green-200 bg-green-50 shadow overflow-hidden">
      {/* header do card */}
      <div className="-mx-6 -mt-6 px-6 py-3 bg-green-600 text-white rounded-t-2xl flex items-center gap-2 relative">
        {view !== "main" && (
          <button
            onClick={() => setView("main")}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-md hover:bg-white/10"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <TrendingUp className="w-5 h-5" />
        <span className="text-lg font-bold">Rentabilidade</span>
      </div>

      <div className="relative mt-4 min-h-[220px]">
        <AnimatePresence mode="wait">
          {view === "main" ? (
            /* ------ VISÃO RESUMIDA ------ */
            <motion.div key="main" initial={{ y: 0, opacity: 1 }} exit={exitUp} className="space-y-4">
              <div>
                <div className="text-3xl font-bold text-green-600">
                  R$ {credits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </div>
                <div className="text-sm text-gray-600">Acúmulo mensal (soma dos geradores)</div>
              </div>

              <div className="rounded-xl bg-white/80 p-4 flex items-center justify-between">
                <span className="text-black">Economia Estimada (dia)</span>
                <span className="font-semibold text-green-700">
                  R$ {totals.totalRDia.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 300, damping: 20, mass: 0.2 }}
                onClick={() => setView("detail")}
                className="w-full h-12 rounded-xl bg-green-600 text-white font-medium active:scale-[.99] inline-flex items-center justify-center gap-2"
              >
                <Calculator className="w-5 h-5" />
                Ver Detalhes
              </motion.button>
            </motion.div>
          ) : (
            /* ------ DETALHES (ROI + LISTA) ------ */
            <motion.div
              key="detail"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: springIn }}
              exit={exitUp}
              className="space-y-5"
            >
              {/* ROI */}
              <div className="rounded-xl bg-white/85 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Retorno do Investimento</span>
                  <span className="text-sm font-semibold text-green-700">{percent.toFixed(1)}%</span>
                </div>
                <Progress value={percent} />
                <div className="mt-2 grid grid-cols-3 text-xs text-gray-600">
                  <div>R$ {credits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                  <div className="text-center">{monthsLeft} meses restantes</div>
                  <div className="text-right">R$ {roiTarget.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* Produção por gerador — espelha *exatamente* os geradores do outro card */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700">Produção por Gerador</h4>

                {generators.map((g, i) => (
                  <div key={i} className="rounded-xl bg-white/85 p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 truncate">{g.nome}</div>
                      <div className="text-xs text-gray-600">{g.kwhDia} kWh/dia</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-700">{g.kwp} kWp</div>
                      <div className="text-xs text-green-700 font-semibold">
                        R$ {g.rDia.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} / dia
                      </div>
                      <div className="text-xs text-green-700 font-semibold">
                        R$ {g.rMes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} / mês
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
