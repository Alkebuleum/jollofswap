import { useEffect, useMemo, useState } from 'react'
import { useP2PStore, Merchant } from '../store/p2pStore'
import { formatMoney, timeLeft } from '../lib/format'

export default function P2PSell(){
  const { merchants, orders, setOrderPaid, releaseOrder, cancelOrder, disputeOrder, sendChat, tick } = useP2PStore()
  const [view, setView] = useState<'market'|'orders'>('market')
  const [amountJLF, setAmountJLF] = useState(100)

  useEffect(()=>{
    const t = setInterval(()=> tick(), 1000)
    return ()=> clearInterval(t)
  }, [tick])

  return (
    <div className="page">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold">Sell / Manage Orders</h1>
        <div className="flex gap-2">
          <button className={`btn ${view==='market'?'btn-primary':'btn-outline'}`} onClick={()=> setView('market')}>Market</button>
          <button className={`btn ${view==='orders'?'btn-primary':'btn-outline'}`} onClick={()=> setView('orders')}>My Orders</button>
        </div>
      </div>

      {view==='market' && <MarketView merchants={merchants} amountJLF={amountJLF} setAmountJLF={setAmountJLF} />}
      {view==='orders' && <OrdersView />}
    </div>
  )
}

function MarketView({merchants, amountJLF, setAmountJLF}:{merchants:Merchant[], amountJLF:number, setAmountJLF:(n:number)=>void}){
  return (
    <div className="space-y-3">
      <div className="card p-4 grid md:grid-cols-3 gap-3">
        <div>
          <label className="label">Amount (JLF)</label>
          <input className="input" type="number" value={amountJLF} onChange={e=> setAmountJLF(parseFloat(e.target.value||'0'))} />
        </div>
        <div>
          <label className="label">Auto-price suggestion</label>
          <div className="input bg-jlfIvory">{(merchants[0]?.price||1000).toFixed(2)} avg</div>
        </div>
        <div className="flex items-end"><button className="btn btn-primary w-full">List Sell Offer</button></div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {merchants.map(m=> <div key={m.id} className="card p-4">
          <div className="flex items-center justify-between">
            <div className="font-bold">{m.name}</div>
            <div className="text-sm">{formatMoney(m.price)}/JLF</div>
          </div>
          <div className="text-xs text-jlfCharcoal/70 mb-2">{m.rating}★ · {m.successRate}%</div>
          <button className="btn btn-outline w-full">Sell to {m.name}</button>
        </div>)}
      </div>
    </div>
  )
}

function OrdersView(){
  const { orders, setOrderPaid, releaseOrder, cancelOrder, disputeOrder, sendChat } = useP2PStore()
  return (
    <div className="grid gap-4">
      {orders.map(o=> <div key={o.id} className="card p-4">
        <div className="flex items-center justify-between">
          <div className="font-bold">Order {o.id}</div>
          <StatusBadge status={o.status} />
        </div>
        <div className="grid md:grid-cols-4 gap-2 text-sm mt-2">
          <div><span className="text-jlfCharcoal/70">Side:</span> {o.side}</div>
          <div><span className="text-jlfCharcoal/70">Amount:</span> {o.amountJLF} JLF</div>
          <div><span className="text-jlfCharcoal/70">Total:</span> {o.fiatTotal}</div>
          <div><span className="text-jlfCharcoal/70">Expires:</span> {timeLeft(o.expiresAt - Date.now())}</div>
        </div>
        <div className="mt-3 flex gap-2">
          {o.status==='awaiting_payment' && <button className="btn btn-primary" onClick={()=> setOrderPaid(o.id)}>I’ve Paid</button>}
          {o.status==='paid' && <button className="btn btn-primary" onClick={()=> releaseOrder(o.id)}>Release Funds</button>}
          {['awaiting_payment','paid'].includes(o.status) && <button className="btn btn-outline" onClick={()=> cancelOrder(o.id)}>Cancel</button>}
          {['awaiting_payment','paid'].includes(o.status) && <button className="btn btn-outline" onClick={()=> disputeOrder(o.id, 'Payment issue')}>Open Dispute</button>}
        </div>
        <div className="mt-3">
          <div className="label mb-1">Chat</div>
          <div className="border border-brand rounded-lg p-2 h-36 overflow-auto bg-white">
            {o.chat.map((c, i)=> <div key={i} className={`my-1 ${c.from==='me'?'text-right':''}`}><span className={`inline-block px-2 py-1 rounded ${c.from==='me'?'bg-jlfTomato text-white':'bg-jlfIvory text-jlfCharcoal'}`}>{c.text}</span></div>)}
          </div>
          <div className="flex gap-2 mt-2">
            <input className="input" placeholder="Write a message" id={"msg_"+o.id} />
            <button className="btn btn-outline" onClick={()=>{
              const el = document.getElementById("msg_"+o.id) as HTMLInputElement
              if(el?.value){
                sendChat(o.id, 'me', el.value)
                el.value=''
              }
            }}>Send</button>
          </div>
        </div>
      </div>)}
      {orders.length===0 && <div className="text-sm text-jlfCharcoal/70">No orders yet. Create one from P2P Buy.</div>}
    </div>
  )
}

function StatusBadge({status}:{status:string}){
  const map: Record<string,string> = {
    created:'bg-gray-100 text-gray-700',
    awaiting_payment:'bg-yellow-100 text-yellow-700',
    paid:'bg-blue-100 text-blue-700',
    released:'bg-green-100 text-green-700',
    cancelled:'bg-gray-100 text-gray-700',
    disputed:'bg-red-100 text-red-700'
  }
  return <span className={"px-2 py-0.5 rounded-full text-xs font-semibold "+(map[status]||'bg-gray-100')}>{status}</span>
}
