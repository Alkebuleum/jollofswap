export const CHAIN = {
    POLY_AMOY: {
        chainId: 80002,
        hex: "0x13882",
        name: "Polygon Amoy",
        rpcUrls: ["https://rpc-amoy.polygon.technology"],
        nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
        blockExplorerUrls: ["https://amoy.polygonscan.com"],
    },
    ALK: {
        chainId: 237422,
        hex: "0x39f6e",
        name: "Alkebuleum",
        rpcUrls: ["https://rpc.alkebuleum.com"],
        nativeCurrency: { name: "ALKE", symbol: "ALKE", decimals: 18 },
        blockExplorerUrls: ["https://explorer.alkebuleum.com"], // change if needed
    },
    BSC: {
        chainId: 56,
        hex: "0x38",
        name: "BNB Chain",
        rpcUrls: [(import.meta.env.VITE_BSC_RPC as string) || "https://bsc-dataseed.binance.org"],
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        blockExplorerUrls: [(import.meta.env.VITE_BSC_EXPLORER as string) || "https://bscscan.com"],
    },
} as const;

export async function switchOrAddChain(targetHex: string, params: any) {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet found (window.ethereum).");

    try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetHex }] });
    } catch (e: any) {
        // 4902 = chain not added
        if (e?.code === 4902) {
            await eth.request({ method: "wallet_addEthereumChain", params: [params] });
            await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetHex }] });
            return;
        }
        throw e;
    }
}
