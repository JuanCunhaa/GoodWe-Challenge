import { TrendingUp, Calculator, ArrowLeft } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "../../state/AppStore.jsx";
import { goodweApi, convertToBRL } from "../../services/goodweApi.js";

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

  // SEMS incomes (BRL)
  const [edayIncomeBRL, setEdayIncomeBRL] = useState(null);
  const [edayRaw, setEdayRaw] = useState({ value: null, currency: 'BRL' });
  const [totalIncomeBRL, setTotalIncomeBRL] = useState(null);
  const [totalRaw, setTotalRaw] = useState({ value: null, currency: 'BRL' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!token || !user?.powerstation_id) return;
    (async () => {
      setLoading(true); setError('');
      try {
        // Daily income (monitor)
        const mon = await goodweApi.monitor(token, user.powerstation_id);
        if (String(mon?.code) !== '0') throw new Error(mon?.msg || 'Falha ao consultar monitor');
        const it = mon?.data?.list?.[0] || {};
        const dIncome = Number(it.eday_income || 0);
        const dCur = String(it.currency || 'BRL');
        setEdayRaw({ value: dIncome, currency: dCur });
        setEdayIncomeBRL(Math.round((convertToBRL(dIncome, dCur) || 0) * 100) / 100);

        // Total income (plant detail)
        const det = await goodweApi.plantDetail(token, user.powerstation_id);
        if (String(det?.code) !== '0') throw new Error(det?.msg || 'Falha ao consultar plant detail');
        const tIncome = Number(det?.data?.kpi?.total_income || 0);
        const tCur = String(det?.data?.kpi?.currency || dCur);
        setTotalRaw({ value: tIncome, currency: tCur });
        setTotalIncomeBRL(Math.round((convertToBRL(tIncome, tCur) || 0) * 100) / 100);
      } catch (e) {
        setError(String(e.message || e));
      } finally { setLoading(false); }
    })();
  }, []);

  // For ROI mock
  const credits = totalIncomeBRL ?? 0;
  const roiTarget = 45000; // exemplo
  const monthsLeft = useMemo(() => {
    const perMonth = totals.totalRMes || 1;
    return Math.max(0, Math.ceil((roiTarget - (credits || 0)) / perMonth));
  }, [roiTarget, credits, totals.totalRMes]);
  const percent = ((credits || 0) / roiTarget) * 100;

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

      <div className="relative mt-4 min-h-[120px]">
        <AnimatePresence mode="wait">
          {view === "main" ? (
            /* ------ VISÃO RESUMIDA ------ */
            <motion.div key="main" initial={{ y: 0, opacity: 1 }} exit={exitUp} className="space-y-4">
              <div>
                <div className="text-3xl font-bold text-green-600">
                  {loading ? '...' : `R$ ${Number(credits||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </div>
                <div className="text-sm text-gray-600">Renda total</div>

                {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
              </div>

              <div className="rounded-xl bg-white/80 p-4 flex items-center justify-between">
                <span className="text-black">Renda do Dia:</span>
                <span className="font-semibold text-green-700">
                  {loading ? '...' : `R$ ${Number(edayIncomeBRL||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
              </div>

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
                  <div>R$ {Number(credits||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="text-center">{monthsLeft} meses restantes</div>
                  <div className="text-right">R$ {roiTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* Produção por Gerador (mock atual) */}
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
                        R$ {g.rDia.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / dia
                      </div>
                      <div className="text-xs text-green-700 font-semibold">
                        R$ {g.rMes.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / mês
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

