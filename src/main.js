import * as core from '@actions/core'
import { createCommandRouter, setJsonOutput, handleError } from '@w3-io/action-core'
import { OpenTradeClient, OpenTradeError } from './opentrade.js'

/**
 * W3 OpenTrade Action — command dispatch.
 *
 * 8 commands for stablecoin yield vault operations:
 * deposit, redeem, balance queries, and vault monitoring.
 *
 * Wallets must be KYC'd and whitelisted by OpenTrade for
 * write operations (deposit, request-redeem).
 */

let bridgeFn

function getBridge() {
  if (bridgeFn) return bridgeFn
  throw new OpenTradeError('BRIDGE_NOT_AVAILABLE', 'W3 bridge is not available in this context')
}

async function initBridge() {
  if (bridgeFn) return
  try {
    const mod = await import('@w3-io/action-core')
    if (mod.bridge && typeof mod.bridge.chain === 'function') {
      bridgeFn = mod.bridge.chain
    }
  } catch {
    // Bridge not available — will throw on use
  }
}

/** Allow tests to inject a mock bridge. */
export function setBridge(fn) {
  bridgeFn = fn
}

function getClient() {
  const network = core.getInput('network', { required: true })
  return new OpenTradeClient({ network, bridge: getBridge() })
}

const handlers = {
  // ── Write operations ────────────────────────────────────────
  deposit: async () => {
    const r = await getClient().deposit({
      vault: core.getInput('vault', { required: true }),
      amount: core.getInput('amount', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'request-redeem': async () => {
    const r = await getClient().requestRedeem({
      vault: core.getInput('vault', { required: true }),
      shares: core.getInput('shares', { required: true }),
    })
    setJsonOutput('result', r)
  },

  // ── Read operations ─────────────────────────────────────────
  'get-balance': async () => {
    const r = await getClient().getBalance({
      vault: core.getInput('vault', { required: true }),
      user: core.getInput('user', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-asset-balance': async () => {
    const r = await getClient().getAssetBalance({
      vault: core.getInput('vault', { required: true }),
      user: core.getInput('user', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-exchange-rate': async () => {
    const r = await getClient().getExchangeRate({
      vault: core.getInput('vault', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-vault-info': async () => {
    const r = await getClient().getVaultInfo({
      vault: core.getInput('vault', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'is-permitted': async () => {
    const r = await getClient().isPermitted({
      vault: core.getInput('vault', { required: true }),
      user: core.getInput('user', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-pool-overview': async () => {
    const r = await getClient().getPoolOverview({
      vault: core.getInput('vault', { required: true }),
    })
    setJsonOutput('result', r)
  },
}

const router = createCommandRouter(handlers)

export async function run() {
  await initBridge()
  try {
    router()
  } catch (error) {
    handleError(error)
  }
}
