import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import { ERC20_ABI } from "./abis";

export async function getProvider() {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet found (window.ethereum).");
    return new BrowserProvider(eth);
}

export async function getSigner() {
    const provider = await getProvider();
    return provider.getSigner();
}

export async function getChainId(): Promise<number> {
    const provider = await getProvider();
    const n = await provider.getNetwork();
    return Number(n.chainId);
}

export async function connectWallet(): Promise<string> {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet found (window.ethereum).");
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    return accounts?.[0];
}

export async function readErc20Balance(token: string, user: string) {
    const provider = await getProvider();
    const c = new Contract(token, ERC20_ABI, provider);
    const [bal, dec] = await Promise.all([c.balanceOf(user), c.decimals()]);
    return { raw: bal as bigint, decimals: Number(dec), formatted: formatUnits(bal, dec) };
}

export async function readAllowance(token: string, owner: string, spender: string) {
    const provider = await getProvider();
    const c = new Contract(token, ERC20_ABI, provider);
    return (await c.allowance(owner, spender)) as bigint;
}

export async function approveErc20(token: string, spender: string, amount: string) {
    const signer = await getSigner();
    const c = new Contract(token, ERC20_ABI, signer);
    const dec: number = await c.decimals();
    const tx = await c.approve(spender, parseUnits(amount, dec));
    return tx;
}
