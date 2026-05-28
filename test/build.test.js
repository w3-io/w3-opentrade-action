/**
 * Tests for the intent-builder commands: buildApprove + buildDeposit.
 * Both are pure functions — no bridge, no chain call, no signer.
 * Verifies ABI encoding, vault resolution, USDC address per network,
 * and shape of the returned intent.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildApprove,
  buildDeposit,
  resolveVaultAddress,
  OpenTradeError,
} from '../src/opentrade.js'
import { encodeApprove, encodeOpenTradeDeposit, parseUsdcAmount } from '../src/encode.js'

const XFTB = '0x061329361E0f163125225bf71a1E5AF954b46869'
const XTBT = '0xad6605F4987031fd2d6d6816bE53Eb7C5b764bf7'
const AVAX_USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECEIVER = '0x099703d7DE5d11979FC8dF5A86F006F5Cd5a180E'

describe('parseUsdcAmount', () => {
  // Output is decimal-string of base units (6 decimals). Comparing
  // BigInt-equivalent values rather than exact string lets through
  // benign leading zeros from concatenation, which BigInt parses
  // correctly.
  it('converts whole USDC to 6-decimal base units', () => {
    assert.equal(BigInt(parseUsdcAmount('40')), 40_000_000n)
    assert.equal(BigInt(parseUsdcAmount('1')), 1_000_000n)
    assert.equal(BigInt(parseUsdcAmount('0')), 0n)
  })
  it('handles fractional input with padding', () => {
    assert.equal(BigInt(parseUsdcAmount('1.5')), 1_500_000n)
    assert.equal(BigInt(parseUsdcAmount('0.000001')), 1n)
    assert.equal(BigInt(parseUsdcAmount('0.01')), 10_000n)
  })
  it('truncates extra fractional digits', () => {
    assert.equal(BigInt(parseUsdcAmount('1.1234567')), 1_123_456n)
  })
  it('rejects non-string', () => {
    assert.throws(() => parseUsdcAmount(40), /must be a string/)
  })
})

describe('encodeApprove', () => {
  it('produces selector + 32-byte spender + 32-byte amount (4+32+32 bytes = 138 hex)', () => {
    const hex = encodeApprove(XFTB, '40000000')
    assert.equal(hex.length, 2 + 8 + 64 + 64) // 0x + selector + spender + amount
    assert.match(hex, /^0x095ea7b3/)
  })
  it('embeds spender lowercase right-padded in arg 1', () => {
    const hex = encodeApprove(XFTB, '40000000')
    const arg1 = hex.slice(10, 10 + 64)
    assert.equal(arg1.toLowerCase(), '0'.repeat(24) + XFTB.toLowerCase().slice(2))
  })
  it('embeds amount as uint256 in arg 2', () => {
    const hex = encodeApprove(XFTB, '40000000')
    const arg2 = hex.slice(10 + 64)
    assert.equal(BigInt('0x' + arg2), 40000000n)
  })
})

describe('encodeOpenTradeDeposit', () => {
  it('produces selector 0x6e553f65 + amount + receiver', () => {
    const hex = encodeOpenTradeDeposit('40000000', RECEIVER)
    assert.equal(hex.length, 2 + 8 + 64 + 64)
    assert.match(hex, /^0x6e553f65/)
    const argAmount = hex.slice(10, 10 + 64)
    const argReceiver = hex.slice(10 + 64)
    assert.equal(BigInt('0x' + argAmount), 40000000n)
    assert.equal(argReceiver.toLowerCase(), '0'.repeat(24) + RECEIVER.toLowerCase().slice(2))
  })
})

describe('resolveVaultAddress', () => {
  it('resolves a known symbol to its address', () => {
    assert.equal(resolveVaultAddress('XFTB', 'avalanche'), XFTB)
    assert.equal(resolveVaultAddress('xftb', 'avalanche'), XFTB)
  })
  it('passes through a 0x-prefixed value', () => {
    assert.equal(resolveVaultAddress(XTBT, 'avalanche'), XTBT)
  })
  it('throws on unknown symbol', () => {
    assert.throws(() => resolveVaultAddress('XUNKNOWN', 'avalanche'), OpenTradeError)
  })
  it('throws without network', () => {
    assert.throws(() => resolveVaultAddress('XFTB', undefined), OpenTradeError)
  })
})

describe('buildApprove', () => {
  it('builds an Avalanche XFTB approve intent', () => {
    const intent = buildApprove({ vault: 'XFTB', amount: '40', network: 'avalanche' })
    assert.equal(intent.intent, 'erc20-approve')
    assert.equal(intent.chain, 'avalanche')
    assert.equal(intent.chainId, 43114)
    assert.equal(intent.to, AVAX_USDC)
    assert.equal(intent.spender, XFTB)
    assert.equal(intent.token, AVAX_USDC)
    assert.equal(intent.vault, XFTB)
    assert.equal(BigInt(intent.amount), 40_000_000n)
    assert.equal(intent.amountFormatted, '40')
    assert.equal(intent.selector, '0x095ea7b3')
    assert.match(intent.data.hex_data, /^0x095ea7b3/)
  })

  it('builds an Ethereum approve with the right USDC address', () => {
    const intent = buildApprove({ vault: XTBT, amount: '20', network: 'ethereum' })
    assert.equal(intent.to, ETH_USDC)
    assert.equal(intent.chainId, 1)
  })

  it('honors an explicit spender override', () => {
    const customSpender = '0x1234567890abcdef1234567890abcdef12345678'
    const intent = buildApprove({
      vault: 'XFTB',
      amount: '40',
      network: 'avalanche',
      spender: customSpender,
    })
    assert.equal(intent.spender, customSpender)
  })

  it('rejects missing amount', () => {
    assert.throws(() => buildApprove({ vault: 'XFTB', network: 'avalanche' }), /amount is required/)
  })

  it('rejects unsupported network', () => {
    assert.throws(
      () => buildApprove({ vault: 'XFTB', amount: '40', network: 'solana' }),
      /not supported/,
    )
  })

  it('rejects an invalid explicit spender address', () => {
    assert.throws(
      () =>
        buildApprove({
          vault: 'XFTB',
          amount: '40',
          network: 'avalanche',
          spender: 'not-an-address',
        }),
      /spender must be a 20-byte hex address/,
    )
  })
})

describe('buildDeposit', () => {
  it('builds an Avalanche XFTB deposit intent', () => {
    const intent = buildDeposit({
      vault: 'XFTB',
      amount: '40',
      receiver: RECEIVER,
      network: 'avalanche',
    })
    assert.equal(intent.intent, 'erc4626-deposit')
    assert.equal(intent.chain, 'avalanche')
    assert.equal(intent.chainId, 43114)
    assert.equal(intent.to, XFTB)
    assert.equal(intent.vault, XFTB)
    assert.equal(intent.underlying, AVAX_USDC)
    assert.equal(BigInt(intent.amount), 40_000_000n)
    assert.equal(intent.amountFormatted, '40')
    assert.equal(intent.receiver, RECEIVER)
    assert.equal(intent.selector, '0x6e553f65')
    assert.match(intent.data.hex_data, /^0x6e553f65/)
  })

  it('rejects missing receiver', () => {
    assert.throws(
      () => buildDeposit({ vault: 'XFTB', amount: '40', network: 'avalanche' }),
      /receiver is required/,
    )
  })

  it('rejects invalid receiver address', () => {
    assert.throws(
      () =>
        buildDeposit({
          vault: 'XFTB',
          amount: '40',
          receiver: 'not-an-address',
          network: 'avalanche',
        }),
      /receiver must be a 20-byte hex address/,
    )
  })

  it('rejects unknown vault symbol', () => {
    assert.throws(
      () =>
        buildDeposit({
          vault: 'XUNKNOWN',
          amount: '40',
          receiver: RECEIVER,
          network: 'avalanche',
        }),
      /Unknown vault/,
    )
  })
})
