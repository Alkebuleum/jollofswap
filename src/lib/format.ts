export function formatMoney(n:number, currency='NGN'){
  const map: Record<string,string> = { NGN:'₦', GHS:'₵', LRD:'L$', KES:'KSh', RWF:'FRw', ZAR:'R' }
  const sym = map[currency] || ''
  return sym + new Intl.NumberFormat().format(n)
}
export function timeLeft(ms:number){
  const s = Math.max(0, Math.floor(ms/1000))
  const m = Math.floor(s/60), r = s%60
  return `${m}:${String(r).padStart(2,'0')}`
}
