// src/components/cards/Alexa.jsx
import {
  Mic, MicOff, Smartphone, MessageCircle, CheckCircle2, Cog, RotateCw,
  ArrowLeft
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { verifyAlexaStep, checkAlexaConnection } from "../../services/alexaApi.js";
import alexaLogo from "../../assets/alexa-logo.png";

const springIn = { type: "spring", stiffness: 260, damping: 22 };
const exitUp   = { y: -8, opacity: 0, transition: { duration: 0.18 } };

export default function Alexa() {
  // step: 1..6 (6 = conectado), ou "error"
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const connected = step === 6;

  // watcher de conexão após “conectado”
  const timerRef = useRef(null);
  useEffect(() => {
    clearInterval(timerRef.current);
    if (connected) {
      timerRef.current = setInterval(async () => {
        try {
          const ok = await checkAlexaConnection();
          if (!ok) setStep("error");
        } catch {
          setStep("error");
        }
      }, 5000);
    }
    return () => clearInterval(timerRef.current);
  }, [connected]);

  async function next() {
    if (loading) return;
    setLoading(true);
    try {
      const ok = await verifyAlexaStep(step);
      if (!ok) {
        setStep("error");
      } else {
        setStep((s) => Math.min(6, (typeof s === "number" ? s : 1) + 1));
      }
    } catch {
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  function backToStart() {
    setStep(1);
    setLoading(false);
  }

  return (
      <div
        className="relative card p-6 rounded-2xl border shadow overflow-hidden"
        style={{ backgroundColor: "#E6FAFF", borderColor: "#BAEEFB" }}  // azul claro do card
      >
        <div
          className="-mx-6 -mt-6 px-6 py-3 text-white rounded-t-2xl flex items-center gap-2 relative"
          style={{ backgroundColor: "#00CFFF" }}  // faixa superior (header)
        >
          {/* botão de voltar igual... */}
          <img src={alexaLogo} alt="Alexa" className="w-5 h-5 rounded-sm" />
          <span className="text-lg font-bold">Integração Alexa</span>

        {connected && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Conectado
          </span>
        )}
      </div>

      {/* conteudo */}
      <div className="relative mt-4 min-h-[280px]">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <StepShell key="s1" icon={<Mic className="w-9 h-9 text-sky-600" />} dots={1}>
              <h3 className="text-center text-lg font-semibold mb-2">Conecte com a Alexa</h3>
              <p className="text-center text-sm text-sky-950/80">
                Controle seu sistema solar por comandos de voz
              </p>

              <div className="mt-6 rounded-2xl bg-white/80 p-4">
                <p className="font-semibold mb-3">Recursos:</p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Monitoramento por voz
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Alertas automáticos
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Controle inteligente
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Sugestões personalizadas
                  </li>
                </ul>
              </div>

              <FooterNext onNext={next} loading={loading} />
            </StepShell>
          )}

          {step === 2 && (
            <StepShell key="s2" icon={<Smartphone className="w-9 h-9 text-indigo-600" />} dots={2}>
              <h3 className="text-center text-lg font-semibold mb-2">Passo 1: Abrir App Alexa</h3>
              <p className="text-center text-sm text-sky-950/80">
                Abra o aplicativo Amazon Alexa no seu smartphone
              </p>
              <FooterNext onNext={next} loading={loading} />
            </StepShell>
          )}

          {step === 3 && (
            <StepShell key="s3" icon={<MessageCircle className="w-9 h-9 text-indigo-600" />} dots={3}>
              <h3 className="text-center text-lg font-semibold mb-2">Passo 2: Buscar Skill</h3>
              <p className="text-center text-sm text-sky-950/80">
                Procure por &apos;GoodWe AlexaWe&apos; na seção Skills &amp; Jogos
              </p>
              <FooterNext onNext={next} loading={loading} />
            </StepShell>
          )}

          {step === 4 && (
            <StepShell key="s4" icon={<CheckCircle2 className="w-9 h-9 text-indigo-600" />} dots={4}>
              <h3 className="text-center text-lg font-semibold mb-2">Passo 3: Ativar Skill</h3>
              <p className="text-center text-sm text-sky-950/80">
                Ative a skill e faça login com sua conta GoodWe
              </p>
              <FooterNext onNext={next} loading={loading} />
            </StepShell>
          )}

          {step === 5 && (
            <StepShell key="s5" icon={<Cog className="w-9 h-9 text-indigo-600" />} dots={4}>
              <h3 className="text-center text-lg font-semibold mb-2">Passo 4: Descobrir Dispositivos</h3>
              <p className="text-center text-sm text-sky-950/80">
                Permita que a Alexa descubra seus dispositivos solares
              </p>
              <FooterNext label="Finalizar" onNext={next} loading={loading} />
            </StepShell>
          )}

          {step === 6 && (
            <StepShell key="s6" icon={<CheckCircle2 className="w-10 h-10 text-emerald-500" />}>
              <h3 className="text-center text-lg font-semibold mb-2">Alexa Conectada!</h3>
              <p className="text-center text-sm text-sky-950/80">
                Seu sistema está pronto para comandos de voz
              </p>

              <div className="mt-6 rounded-2xl bg-white/80 p-4">
                <p className="font-semibold mb-3">Comandos Disponíveis:</p>
                <div className="space-y-2">
                  <CommandChip>“Alexa, qual a produção solar hoje?”</CommandChip>
                  <CommandChip>“Alexa, como está a bateria?”</CommandChip>
                  <CommandChip>“Alexa, iniciar carregamento do carro”</CommandChip>
                </div>
              </div>

              <div className="mt-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 p-3 flex items-start gap-2">
                <Mic className="w-4 h-4 text-emerald-600 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-emerald-700">Status Ativo</div>
                  <div className="text-sm text-emerald-700/90">
                    Sua Alexa está monitorando o sistema e pode sugerir otimizações
                  </div>
                </div>
              </div>
            </StepShell>
          )}

          {step === "error" && (
            <StepShell key="err" icon={<MicOff className="w-9 h-9 text-red-600" />}>
              <h3 className="text-center text-lg font-semibold mb-2">Falha ao conectar</h3>
              <p className="text-center text-sm text-red-900/80">
                Não foi possível validar esta etapa. Tente novamente.
              </p>

              <div className="mt-6 rounded-2xl bg-red-50 border border-red-200 p-4 text-red-800">
                <div className="font-semibold">Possíveis causas</div>
                <ul className="list-disc pl-5 text-sm mt-1 space-y-1">
                  <li>App Alexa não aberto/logado</li>
                  <li>Skill não ativada ou sem permissão</li>
                  <li>Sem internet ou indisponibilidade temporária</li>
                </ul>
              </div>

              <div className="mt-6 flex justify-center">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={backToStart}
                  className="h-11 px-4 rounded-xl bg-sky-600 text-white inline-flex items-center gap-2 shadow-sm"
                >
                  <RotateCw className="w-4 h-4" />
                  Reconectar
                </motion.button>
              </div>
            </StepShell>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------- Subcomponentes ---------- */

function StepShell({ children, icon, dots = 0 }) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: springIn }}
      exit={exitUp}
    >
      <div className="flex flex-col items-center">
        {dots > 0 && <Dots active={dots} total={4} />}
        <div className="mt-3">{icon}</div>
      </div>
      <div className="mt-5">{children}</div>
    </motion.div>
  );
}

function Dots({ active, total }) {
  const arr = useMemo(() => Array.from({ length: total }), [total]);
  return (
    <div className="flex gap-2 mt-2">
      {arr.map((_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${
            i < active ? "bg-indigo-600" : "bg-slate-300"
          }`}
        />
      ))}
    </div>
  );
}

function FooterNext({ onNext, loading, label = "Próximo" }) {
  return (
    <div className="mt-6 flex justify-center">
      <motion.button
        whileHover={{ scale: loading ? 1 : 1.03 }}
        whileTap={{ scale: loading ? 1 : 0.98 }}
        onClick={onNext}
        disabled={loading}
        className={`h-11 px-6 rounded-xl text-white shadow-sm inline-flex items-center gap-2
        bg-sky-400 ${loading ? "cursor-not-allowed" : ""}`}
      >
        {label}
      </motion.button>
    </div>
  );
}

function CommandChip({ children }) {
  return (
    <div className="rounded-lg border border-sky-200 bg-white/70 px-3 py-2 text-sky-900 text-sm">
      {children}
    </div>
  );
}
