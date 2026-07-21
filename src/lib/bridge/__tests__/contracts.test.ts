import { describe, it, expect } from 'vitest'
import { encodeLockForBnb, encodeBurnForAlkebuleum, vaultInterface, bnbTokenInterface } from '../contracts'
import { ALKEBULEUM_CHAIN_ID, BSC_CHAIN_ID, ALKE_CANONICAL_VAULT_ADDRESS, ALKE_BNB_TOKEN_ADDRESS } from '../config'

const RECIPIENT = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4'
const AMOUNT = 1300000000000000000000n

describe('encodeLockForBnb', () => {
  it('targets the canonical vault on Alkebuleum with msg.value = amount', () => {
    const tx = encodeLockForBnb(RECIPIENT, AMOUNT)
    expect(tx.to).toBe(ALKE_CANONICAL_VAULT_ADDRESS)
    expect(tx.value).toBe(AMOUNT)
    expect(tx.chainId).toBe(ALKEBULEUM_CHAIN_ID)
  })

  it('encodes calldata that decodes back to lockForBnb(recipient)', () => {
    const tx = encodeLockForBnb(RECIPIENT, AMOUNT)
    const decoded = vaultInterface.decodeFunctionData('lockForBnb', tx.data)
    expect(decoded[0].toLowerCase()).toBe(RECIPIENT.toLowerCase())
  })
})

describe('encodeBurnForAlkebuleum', () => {
  it('targets the BNB ALKE token with zero native value', () => {
    const tx = encodeBurnForAlkebuleum(AMOUNT, RECIPIENT)
    expect(tx.to).toBe(ALKE_BNB_TOKEN_ADDRESS)
    expect(tx.value).toBe(0n)
    expect(tx.chainId).toBe(BSC_CHAIN_ID)
  })

  it('encodes calldata that decodes back to burnForAlkebuleum(amount, recipient)', () => {
    const tx = encodeBurnForAlkebuleum(AMOUNT, RECIPIENT)
    const decoded = bnbTokenInterface.decodeFunctionData('burnForAlkebuleum', tx.data)
    expect(decoded[0]).toBe(AMOUNT)
    expect(decoded[1].toLowerCase()).toBe(RECIPIENT.toLowerCase())
  })
})
