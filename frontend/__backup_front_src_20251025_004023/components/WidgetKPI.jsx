export default function WidgetKPI({ label, value, accent='brand' }){
  return (
    <div className="panel hover:shadow-neon transition">
      <div className="text-xs muted">{label}</div>
      <div className="text-3xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">{value}</div>
    </div>
  )
}
