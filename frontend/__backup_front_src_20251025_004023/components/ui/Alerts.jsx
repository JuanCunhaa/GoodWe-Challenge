// src/components/ui/Alerts.jsx
import { AlertCircle } from "lucide-react";

export function AlertBadge({ count = 0 }) {
  if (!count) return null;
  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center
                     rounded-full bg-red-600 text-[10px] font-semibold text-white px-[5px]">
      !
    </span>
  );
}

export function AlertsPanel({ items = [] }) {
  const has = Array.isArray(items) && items.length > 0;

  const color = (lvl) =>
    lvl === "crit" ? "text-red-700"
    : lvl === "warn" ? "text-amber-700"
    : "text-slate-700";

  const dot = (lvl) =>
    lvl === "crit" ? "bg-red-500"
    : lvl === "warn" ? "bg-amber-500"
    : "bg-slate-400";

  return (
    <div className="rounded-xl bg-white/85 p-4">
      <div className="flex items-center gap-2 font-semibold text-gray-800 mb-2">
        <AlertCircle className="w-4 h-4 text-red-600" />
        Alertas
      </div>

      {!has ? (
        <div className="text-sm text-gray-600">Sem alertas no momento.</div>
      ) : (
        <ul className="space-y-2">
          {items.map((a, i) => (
            <li key={a.id ?? i} className={`text-sm ${color(a.level)}`}>
              <span className={`inline-block h-2 w-2 rounded-full ${dot(a.level)} mr-2`} />
              {a.msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
