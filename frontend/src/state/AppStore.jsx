// src/state/AppStore.jsx
import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import { getAlerts } from "../services/alertsApi.js";

const AppContext = createContext(null);

/* ---------------- MOCKS ---------------- */
const initialGenerators = [
  { nome: "Painel Solar Secundário", dia: true, kw: 5.8, kwhDia: 32.1, kwp: 8.2, rDia: 29.38, rMes: 880.0, alerts: [] },
  { nome: "Painel Solar Principal", dia: true, kw: 8.4, kwhDia: 45.2, kwp: 12.5, rDia: 29.38, rMes: 1200.0, alerts: [] },
  { nome: "Gerador 2", dia: true, kw: 2.0, kwhDia: 32.1, kwp: 8.2, rDia: 20.86, rMes: 640.0, alerts: [] },
  { nome: "Gerador 1", dia: false, kw: 0.0, kwhDia: 45.2, kwp: 12.5, rDia: 29.38, rMes: 910.0, alerts: [] },
];

const initialBatteries = [
  { nome:"Bateria 1", soc:0.85, healthPct:94, tempC:28, cyclesUsed:248, cyclesTotal:6000,
    charging:true, chargeRateKW:2.3, capacityKWh:13.5, avgLoadKW:1.6, effChargePct:96, effDischargePct:94, alerts: [] },
  { nome:"Bateria 2", soc:0.67, healthPct:90, tempC:27, cyclesUsed:410, cyclesTotal:6000,
    charging:false, chargeRateKW:0.0, capacityKWh:13.5, avgLoadKW:1.8, effChargePct:95, effDischargePct:92, alerts: [] },
];

const initialChargers = [
  { nome: "Carregador Residencial", nextAt: "22:00", consumoHojeKWh: 35.2, maxKW: 7.4, inUse: true,  alerts: [] },
  { nome: "Carregador Garagem",     nextAt: "21:00", consumoHojeKWh: 12.8, maxKW: 7.4, inUse: false, alerts: [] },
];

const initialVehicles = [
  { nome: "BMW X6",        soc: 0.75, rangeKm: 420, connected: true,  charging: true,  alerts: [] },
  { nome: "Tesla Model Y", soc: 0.45, rangeKm: 240, connected: false, charging: false, alerts: [] },
];

/* ---------------- HELPERS ---------------- */
function hoursToHM(hours) {
  const h = Math.max(0, Math.floor(hours));
  const m = Math.max(0, Math.round((hours - h) * 60));
  return `${h}h:${String(m).padStart(2, "0")}min`;
}

export function AppProvider({ children }) {
  /* 1) ESTADOS PRINCIPAIS */
  const [generators, setGenerators] = useState(initialGenerators);
  const [batteries,  setBatteries]  = useState(initialBatteries);
  const [chargers,   setChargers]   = useState(initialChargers);
  const [vehicles,   setVehicles]   = useState(initialVehicles);

  /* 2) ESTADOS DE ALERTAS (DEVEM VIR ANTES DE USO) */
  const [batteryAlerts,   setBatteryAlerts]   = useState({}); // { [index]: Alert[] }
  const [chargerAlerts,   setChargerAlerts]   = useState({});
  const [vehicleAlerts,   setVehicleAlerts]   = useState({});
  const [generatorAlerts, setGeneratorAlerts] = useState({});

  /* 3) AÇÕES */
  // Generators
  const addGenerator = useCallback((nome) => {
    const novo = { nome, dia: true, kw: 0, kwhDia: 20, kwp: 5, rDia: 12.5, rMes: 380, alerts: [] };
    setGenerators(prev => [...prev, novo]);
  }, []);
  const removeGeneratorAt = useCallback((index) => {
    setGenerators(prev => prev.filter((_, i) => i !== index));
  }, []);
  const updateGenerator = useCallback((index, patch) => {
    setGenerators(prev => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }, []);

  // Batteries
  const addBattery = useCallback((nome) => {
    setBatteries(prev => [...prev, {
      nome, soc:0.5, healthPct:92, tempC:27, cyclesUsed:0, cyclesTotal:6000,
      charging:false, chargeRateKW:0, capacityKWh:13.5, avgLoadKW:1.5,
      effChargePct:95, effDischargePct:93, alerts: []
    }]);
  }, []);
  const removeBatteryAt = useCallback((index) => {
    setBatteries(prev => prev.filter((_, i) => i !== index));
    setBatteryAlerts(prev => {
      const { [index]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);
  const updateBattery = useCallback((index, patch) => {
    setBatteries(prev => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }, []);

  // Chargers
  const addCharger = useCallback((nome) => {
    setChargers(prev => [...prev, { nome, nextAt: "22:00", consumoHojeKWh: 0, maxKW: 7.4, inUse: false, alerts: [] }]);
  }, []);
  const removeChargerAt = useCallback((index) => {
    setChargers(prev => prev.filter((_, i) => i !== index));
    setChargerAlerts(prev => {
      const { [index]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);
  const updateCharger = useCallback((index, patch) => {
    setChargers(prev => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }, []);

  // Vehicles
  const addVehicle = useCallback((nome) => {
    setVehicles(prev => [...prev, { nome, soc: 0.5, rangeKm: 250, connected: false, charging: false, alerts: [] }]);
  }, []);
  const removeVehicleAt = useCallback((index) => {
    setVehicles(prev => prev.filter((_, i) => i !== index));
    setVehicleAlerts(prev => {
      const { [index]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);
  const updateVehicle = useCallback((index, patch) => {
    setVehicles(prev => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }, []);

  // ALERTS fetchers (chamam sua API — stub seguro retorna [])
  const refreshBatteryAlerts = useCallback(async (index) => {
    const b = batteries[index];
    if (!b) return;
    const items = await getAlerts({ type: "battery", name: b.nome });
    setBatteryAlerts(prev => ({ ...prev, [index]: items }));
  }, [batteries]);

  const refreshChargerAlerts = useCallback(async (index) => {
    const c = chargers[index];
    if (!c) return;
    const items = await getAlerts({ type: "charger", name: c.nome });
    setChargerAlerts(prev => ({ ...prev, [index]: items }));
  }, [chargers]);

  const refreshVehicleAlerts = useCallback(async (index) => {
    const v = vehicles[index];
    if (!v) return;
    const items = await getAlerts({ type: "vehicle", name: v.nome });
    setVehicleAlerts(prev => ({ ...prev, [index]: items }));
  }, [vehicles]);

  const refreshGeneratorAlerts = useCallback(async (index) => {
    const g = generators[index];
    if (!g) return;
    const items = await getAlerts({ type: "generator", name: g.nome });
    setGeneratorAlerts(prev => ({ ...prev, [index]: items }));
  }, [generators]);

  /* 4) AGREGADOS */
  const totals = useMemo(() => {
    const totalRMes   = (generators || []).reduce((acc, g) => acc + (g.rMes   || 0), 0);
    const totalRDia   = (generators || []).reduce((acc, g) => acc + (g.rDia   || 0), 0);
    const totalKwhDia = (generators || []).reduce((acc, g) => acc + (g.kwhDia || 0), 0);
    return { totalRMes, totalRDia, totalKwhDia };
  }, [generators]);

  /* 5) VALUE */
  const value = useMemo(() => ({
    // dados
    generators, batteries, chargers, vehicles, totals,
    // ações de dados
    addGenerator, removeGeneratorAt, updateGenerator,
    addBattery,   removeBatteryAt,   updateBattery,
    addCharger,   removeChargerAt,   updateCharger,
    addVehicle,   removeVehicleAt,   updateVehicle,
    // helpers
    hoursToHM,
    // alertas + actions
    batteryAlerts,   refreshBatteryAlerts,
    chargerAlerts,   refreshChargerAlerts,
    vehicleAlerts,   refreshVehicleAlerts,
    generatorAlerts, refreshGeneratorAlerts,
  }), [
    generators, batteries, chargers, vehicles, totals,
    addGenerator, removeGeneratorAt, updateGenerator,
    addBattery,   removeBatteryAt,   updateBattery,
    addCharger,   removeChargerAt,   updateCharger,
    addVehicle,   removeVehicleAt,   updateVehicle,
    hoursToHM,
    batteryAlerts,   refreshBatteryAlerts,
    chargerAlerts,   refreshChargerAlerts,
    vehicleAlerts,   refreshVehicleAlerts,
    generatorAlerts, refreshGeneratorAlerts,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppStore deve ser usado dentro de <AppProvider />");
  return ctx;
}
