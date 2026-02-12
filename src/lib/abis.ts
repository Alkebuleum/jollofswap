export const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
] as const;

// IMPORTANT: update this to match YOUR BridgeVault ABI
// Common patterns are:
//  - deposit(uint256 amount)
//  - deposit(uint256 amount, address recipient)
//  - depositFor(address recipient, uint256 amount)
export const BRIDGEVAULT_ABI = [
    "function deposit(uint256 amount) returns (bytes32)",
    // If your vault uses a different function, replace the line above.
] as const;
