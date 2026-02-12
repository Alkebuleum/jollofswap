import { useP2PStore, Merchant } from '../store/p2pStore'
import { formatMoney } from '../lib/format'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

export default function P2PBuy(){
  const { currency, merchants, createOrder, tick } = useP2PStore()
  const [method, setMethod] = useState('Bank Transfer')
  const [fiat, setFiat] = useState(10000)
  const [sort, setSort] = useState<'best'|'trusted'|'fastest'>('best')

  useEffect(()=>{
    const t = setInterval(()=> tick(), 1000)
    return ()=> clearInterval(t)
  }, [tick])

  const list = useMemo(()=>{
    const copy = [...merchants]
    if(sort==='best') copy.sort((a,b)=> a.price-b.price)
    if(sort==='trusted') copy.sort((a,b)=> b.rating-a.rating)
    if(sort==='fastest') copy.sort((a,b)=> b.successRate-a.successRate)
    return copy.filter(m=> m.paymentMethods.includes(method as any))
  }, [merchants, sort, method])

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold">Buy Jollof (P2P)</h1>
        <Link to="/p2p/sell" className="text-jlfTomato font-semibold">Sell instead →</Link>
      </div>

      <div className="card p-4 mb-4 grid md:grid-cols-4 gap-3">
        <div>
          <label className="label">Currency</label>
          <select className="input">
            <option>{currency}</option>
          </select>
        </div>
        <div>
          <label className="label">Payment Method</label>
          <select className="input" value={method} onChange={e=> setMethod(e.target.value)}>
            <option>Bank Transfer</option>
            <option>Mobile Money</option>
            <option>USSD</option>
            <option>Cash</option>
          </select>
        </div>
        <div>
          <label className="label">Amount ({currency})</label>
          <input className="input" type="number" value={fiat} onChange={e=> setFiat(parseFloat(e.target.value||'0'))} />
        </div>
        <div>
          <label className="label">Sort</label>
          <select className="input" value={sort} onChange={e=> setSort(e.target.value as any)}>
            <option value="best">Best Rate</option>
            <option value="trusted">Most Trusted</option>
            <option value="fastest">Fastest</option>
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {list.map(m=> <MerchantCard key={m.id} m={m} fiat={fiat} onBuy={()=>{
          const order = createOrder(m, 'buy', fiat, method as any)
          window.location.href = '/p2p/sell?orderId='+order.id  // route to order mgmt (shared page sim)
        }} />)}
      </div>
    </div>
  )
}

function MerchantCard({m, fiat, onBuy}:{m:Merchant, fiat:number, onBuy:()=>void}){
  const jlf = (fiat/m.price)||0
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-jlfIvory grid place-content-center text-sm font-extrabold">{m.name.slice(0,2).toUpperCase()}</div>
          <div>
            <div className="font-bold">{m.name} {m.verified && <span className="badge">Verified</span>}</div>
            <div className="text-xs text-jlfCharcoal/70">{m.rating}★ · {m.successRate}% success</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-extrabold">{formatMoney(m.price, 'NGN')}/JLF</div>
          <div className="text-xs text-jlfCharcoal/70">Limit {formatMoney(m.min)} – {formatMoney(m.max)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div className="text-jlfCharcoal/70">You pay</div>
        <div className="font-bold">{formatMoney(fiat)}</div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div className="text-jlfCharcoal/70">You get</div>
        <div className="font-bold">{jlf.toFixed(4)} JLF</div>
      </div>
      <button className="btn btn-primary mt-2" onClick={onBuy}>Buy from {m.name}</button>
    </div>
  )
}
