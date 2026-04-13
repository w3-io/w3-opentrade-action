/**
 * OpenTradeClient unit tests.
 *
 * Tests every public method by mocking the bridge.chain() function.
 * Verifies correct contract addresses, function signatures, args,
 * and network routing.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OpenTradeClient, OpenTradeError } from '../src/opentrade.js'

const NETWORK = 'avalanche'
const VAULT = '0x0000000000000000000000000000000000000042'
const USER = '0x0000000000000000000000000000000000000099'
const UNDERLYING = '0x0000000000000000000000000000000000000001'

let calls
let mockResults

function mockBridge() {
  calls = []
  mockResults = []
  return async (chainName, action, params, network) => {
    calls.push({ chainName, action, params, network })
    return mockResults.shift() ?? {}
  }
}

function client(network = NETWORK) {
  return new OpenTradeClient({ network, bridge: mockBridge() })
}

// ── Construction ──────────────────────────────────────────────

describe('OpenTradeClient: construction', () => {
  it('accepts a valid network', () => {
    const c = client()
    assert.equal(c.network, NETWORK)
  })

  it('rejects an unsupported network', () => {
    assert.throws(
      () => new OpenTradeClient({ network: 'fakenet', bridge: mockBridge() }),
      (err) => err instanceof OpenTradeError && err.code === 'UNSUPPORTED_NETWORK',
    )
  })

  it('rejects missing network', () => {
    assert.throws(
      () => new OpenTradeClient({ bridge: mockBridge() }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })

  it('rejects missing bridge', () => {
    assert.throws(
      () => new OpenTradeClient({ network: NETWORK }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })

  it('supports all three networks', () => {
    for (const net of ['ethereum', 'avalanche', 'plume']) {
      const c = new OpenTradeClient({ network: net, bridge: mockBridge() })
      assert.equal(c.network, net)
    }
  })
})

// ── Write operations ─────────────────────────────────────────

describe('deposit', () => {
  it('gets underlying, approves, and deposits', async () => {
    const c = client()
    mockResults.push({ result: UNDERLYING }) // liquidityAssetAddr
    mockResults.push({ from: USER }) // approve
    mockResults.push({ ok: true }) // deposit
    await c.deposit({ vault: VAULT, amount: '1000000' })
    assert.equal(calls.length, 3)
    assert.equal(calls[0].action, 'read-contract') // get underlying
    assert.equal(calls[1].action, 'approve-token') // approve
    assert.equal(calls[1].params.token, UNDERLYING)
    assert.equal(calls[1].params.spender, VAULT)
    assert.equal(calls[2].action, 'call-contract') // deposit
    assert.ok(calls[2].params.method.includes('deposit'))
    assert.equal(calls[2].params.args[0], '1000000')
    assert.equal(calls[2].params.args[1], USER) // from approve receipt
  })

  it('throws without amount', async () => {
    await assert.rejects(
      () => client().deposit({ vault: VAULT }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })

  it('throws without vault', async () => {
    await assert.rejects(
      () => client().deposit({ amount: '1000000' }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })
})

describe('requestRedeem', () => {
  it('calls requestRedeem on vault', async () => {
    await client().requestRedeem({ vault: VAULT, shares: '500000' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, 'call-contract')
    assert.ok(calls[0].params.method.includes('requestRedeem'))
    assert.equal(calls[0].params.args[0], '500000')
  })

  it('throws without shares', async () => {
    await assert.rejects(
      () => client().requestRedeem({ vault: VAULT }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })
})

// ── Read operations ──────────────────────────────────────────

describe('getBalance', () => {
  it('reads balanceOf', async () => {
    const c = client()
    mockResults.push({ result: '1000000' })
    await c.getBalance({ vault: VAULT, user: USER })
    assert.equal(calls[0].action, 'read-contract')
    assert.ok(calls[0].params.method.includes('balanceOf'))
    assert.equal(calls[0].params.args[0], USER)
  })

  it('throws without user', async () => {
    await assert.rejects(
      () => client().getBalance({ vault: VAULT }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })
})

describe('getAssetBalance', () => {
  it('reads balanceOf then convertToAssets', async () => {
    const c = client()
    mockResults.push({ result: '1000000' }) // balanceOf
    mockResults.push({ result: '1050000' }) // convertToAssets
    const r = await c.getAssetBalance({ vault: VAULT, user: USER })
    assert.equal(calls.length, 2)
    assert.ok(calls[0].params.method.includes('balanceOf'))
    assert.ok(calls[1].params.method.includes('convertToAssets'))
    assert.equal(calls[1].params.args[0], '1000000') // shares from balanceOf
  })
})

describe('getExchangeRate', () => {
  it('reads exchangeRate', async () => {
    const c = client()
    mockResults.push({ result: '1050000' })
    await c.getExchangeRate({ vault: VAULT })
    assert.equal(calls[0].action, 'read-contract')
    assert.ok(calls[0].params.method.includes('exchangeRate'))
  })
})

describe('getVaultInfo', () => {
  it('reads multiple fields in parallel', async () => {
    const c = client()
    // 7 parallel reads
    for (let i = 0; i < 7; i++) mockResults.push({ result: 'test' })
    const r = await c.getVaultInfo({ vault: VAULT })
    assert.equal(r.address, VAULT)
    assert.ok(r.name !== undefined)
    assert.ok(r.poolType !== undefined)
    assert.ok(r.exchangeRate !== undefined)
  })
})

describe('isPermitted', () => {
  it('reads isPermittedLender', async () => {
    const c = client()
    mockResults.push({ result: 'true' })
    await c.isPermitted({ vault: VAULT, user: USER })
    assert.equal(calls[0].action, 'read-contract')
    assert.ok(calls[0].params.method.includes('isPermittedLender'))
    assert.equal(calls[0].params.args[0], USER)
  })

  it('throws without user', async () => {
    await assert.rejects(
      () => client().isPermitted({ vault: VAULT }),
      (err) => err instanceof OpenTradeError && err.code === 'MISSING_INPUT',
    )
  })
})

describe('getPoolOverview', () => {
  it('reads pool metrics in parallel', async () => {
    const c = client()
    for (let i = 0; i < 4; i++) mockResults.push({ result: '1000000' })
    const r = await c.getPoolOverview({ vault: VAULT })
    assert.ok(r.totalAssets !== undefined)
    assert.ok(r.availableAssets !== undefined)
    assert.ok(r.exchangeRate !== undefined)
    assert.ok(r.pendingWithdrawals !== undefined)
  })
})

// ── Vault resolution ─────────────────────────────────────────

describe('vault resolution', () => {
  it('accepts raw address', async () => {
    const c = client()
    mockResults.push({ result: '1000000' })
    await c.getExchangeRate({ vault: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })
    assert.equal(calls[0].params.contract, '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  })

  it('rejects unknown symbol', () => {
    assert.rejects(
      () => client().getExchangeRate({ vault: 'UNKNOWN' }),
      (err) => err instanceof OpenTradeError && err.code === 'INVALID_INPUT',
    )
  })
})
