export default function Farms(){
  return (
    <div className="page grid md:grid-cols-2 gap-6">
      <div className="card p-5">
        <h1 className="text-xl font-extrabold mb-3">Farms / Earn</h1>
        <div className="space-y-3">
          <FarmCard name="JLF/MAH" apr="18%" tvl="$120k" />
          <FarmCard name="JLF/AKE" apr="22%" tvl="$80k" />
        </div>
      </div>
      <div className="card p-5">
        <h2 className="text-xl font-extrabold mb-3">Rewards</h2>
        <div className="text-sm">Pending: 0.00 JLF</div>
        <button className="btn btn-outline mt-3">Harvest All</button>
      </div>
    </div>
  )
}
function FarmCard({name, apr, tvl}:{name:string, apr:string, tvl:string}){
  return (
    <div className="border border-brand rounded-xl p-4 flex items-center justify-between">
      <div>
        <div className="font-bold">{name}</div>
        <div className="text-xs text-jlfCharcoal/70">APR {apr} · TVL {tvl}</div>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-outline">Stake</button>
        <button className="btn btn-outline">Unstake</button>
      </div>
    </div>
  )
}
