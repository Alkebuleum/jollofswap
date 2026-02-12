import { create } from 'zustand'

export type Currency = 'NGN'|'GHS'|'LRD'|'KES'|'RWF'|'ZAR'
export type PaymentMethod = 'Bank Transfer'|'Mobile Money'|'USSD'|'Cash'
export type Side = 'buy' | 'sell'

export type Merchant = {
  id: string
  name: string
  country: string
  rating: number // 0-5
  successRate: number // percent
  verified: boolean
  paymentMethods: PaymentMethod[]
  price: number // fiat per JLF
  min: number
  max: number
}

export type Order = {
  id: string
  side: Side
  merchantId: string
  amountJLF: number
  price: number
  fiatTotal: number
  currency: Currency
  method: PaymentMethod
  status: 'created'|'awaiting_payment'|'paid'|'released'|'cancelled'|'disputed'
  expiresAt: number // timestamp
  chat: { from: 'me'|'them', text: string, ts: number }[]
}

type P2PState = {
  currency: Currency
  method?: PaymentMethod
  merchants: Merchant[]
  orders: Order[]
  createOrder: (m: Merchant, side: Side, amountFiat: number, method: PaymentMethod)=> Order
  setOrderPaid: (id:string)=> void
  releaseOrder: (id:string)=> void
  cancelOrder: (id:string)=> void
  disputeOrder: (id:string, reason:string)=> void
  sendChat: (id:string, from:'me'|'them', text:string)=> void
  tick: ()=> void
}

const sampleMerchants: Merchant[] = [
  { id:'m1', name:'AfroPay Hub', country:'NG', rating:4.9, successRate:98, verified:true, paymentMethods:['Bank Transfer','USSD','Mobile Money'], price:780, min:1000, max:500000 },
  { id:'m2', name:'Momo Express', country:'GH', rating:4.7, successRate:95, verified:true, paymentMethods:['Mobile Money','Cash'], price:12.3, min:50, max:20000 },
  { id:'m3', name:'Kolo Cash', country:'LR', rating:4.5, successRate:92, verified:false, paymentMethods:['Cash','Bank Transfer'], price:210, min:500, max:100000 },
]

export const useP2PStore = create<P2PState>((set, get)=> ({
  currency: 'NGN',
  merchants: sampleMerchants,
  orders: [],
  createOrder: (m, side, amountFiat, method)=>{
    const amountJLF = parseFloat((amountFiat / m.price).toFixed(4))
    const o: Order = {
      id: 'ord_'+Math.random().toString(36).slice(2,8),
      side, merchantId: m.id, amountJLF,
      price: m.price, fiatTotal: amountFiat,
      currency: get().currency, method,
      status: 'awaiting_payment',
      expiresAt: Date.now() + 15*60*1000,
      chat: [
        { from:'them', text:'Hello! Please send payment and click I\'ve Paid.', ts: Date.now() }
      ]
    }
    set(s=>({orders:[o, ...s.orders]}))
    return o
  },
  setOrderPaid: (id)=> set(s=>({orders: s.orders.map(o=> o.id===id? {...o, status:'paid'}:o)})),
  releaseOrder: (id)=> set(s=>({orders: s.orders.map(o=> o.id===id? {...o, status:'released'}:o)})),
  cancelOrder: (id)=> set(s=>({orders: s.orders.map(o=> o.id===id? {...o, status:'cancelled'}:o)})),
  disputeOrder: (id, reason)=> set(s=>({orders: s.orders.map(o=> o.id===id? {...o, status:'disputed', chat:[...o.chat, {from:'me', text:'Opened dispute: '+reason, ts: Date.now()}]}:o)})),
  sendChat: (id, from, text)=> set(s=>({orders: s.orders.map(o=> o.id===id? {...o, chat:[...o.chat, {from, text, ts: Date.now()}]}:o)})),
  tick: ()=> set(s=>({orders: s.orders.map(o=> (o.status==='awaiting_payment' && o.expiresAt<Date.now())? {...o, status:'cancelled'}:o)}))
}))
