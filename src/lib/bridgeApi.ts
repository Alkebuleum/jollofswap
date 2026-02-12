const API = import.meta.env.VITE_BRIDGE_API;

export type DepositStatus = {
    ok: boolean;
    txHash: string;
    logIndex?: number;
    confirmations?: number;
    requiredConfirmations?: number;
    minted?: boolean;
    mintTxHash?: string | null;
    error?: string;
};

// Expecting: GET /deposits/:txHash
export async function fetchDepositStatus(txHash: string): Promise<DepositStatus> {
    const r = await fetch(`${API}/deposits/${txHash}`);
    if (!r.ok) throw new Error(`bridge-api ${r.status}`);
    return r.json();
}
