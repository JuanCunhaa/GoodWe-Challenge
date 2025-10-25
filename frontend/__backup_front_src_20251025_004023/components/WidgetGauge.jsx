export default function WidgetGauge({ label='Eficiência', value=72 }){
  const deg = Math.min(100, Math.max(0, value)) * 1.8 // 0..180deg
  return (
    <div className="panel grid place-items-center">
      <div className="relative w-40 h-20 overflow-hidden">
        <div className="absolute inset-0 origin-bottom-center" style={{transform:`rotate(${deg-90}deg)`}}>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-20 bg-brand rounded-full" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-secondary via-brand to-secondary" />
      </div>
      <div className="mt-2 text-center">
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}%</div>
        <div className="text-xs muted">{label}</div>
      </div>
    </div>
  )
}
