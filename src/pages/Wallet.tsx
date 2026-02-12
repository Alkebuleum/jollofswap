import { useAppStore } from '../store/appStore'

export default function Wallet(){
  const { walletConnected, address } = useAppStore()
  return (
    <div className="page">
      <h1 className="text-2xl font-extrabold mb-4">amVault Wallet</h1>
      {walletConnected? (
        <div className="card p-5">
          <div className="text-sm text-jlfCharcoal/70 mb-2">Connected address</div>
          <div className="font-mono">{address}</div>
          <div className="grid md:grid-cols-3 gap-3 mt-4">
            <BalanceCard sym="JLF" amt="1,200.00" />
            <BalanceCard sym="MAH" amt="560.00" />
            <BalanceCard sym="AKE" amt="200.00" />
          </div>
        </div>
      ): (
        <div className="text-jlfCharcoal/70">Not connected. Use the top-right button to connect your amVault.</div>
      )}
    </div>
  )
}
function BalanceCard({sym, amt}:{sym:string, amt:string}){
  return <div className="border border-brand rounded-xl p-4"><div className="text-sm text-jlfCharcoal/70">{sym}</div><div className="text-xl font-extrabold">{amt}</div></div>
}
