export default function Profile(){
  return (
    <div className="page">
      <h1 className="text-2xl font-extrabold mb-4">Profile</h1>
      <div className="card p-5">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="label">Display Name</label>
            <input className="input" defaultValue="AfroTrader" />
          </div>
          <div>
            <label className="label">Country</label>
            <select className="input"><option>NG</option><option>GH</option><option>LR</option><option>KE</option><option>RW</option><option>ZA</option></select>
          </div>
          <div className="md:col-span-2">
            <button className="btn btn-primary">Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
