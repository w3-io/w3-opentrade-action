import * as core from '@actions/core'
import { createCommandRouter, setJsonOutput, handleError } from '@w3-io/action-core'
import {
  OpenTradeClient,
  OpenTradeError,
  buildApprove,
  buildDeposit,
  buildRequestRedeem,
  getApy,
} from './opentrade.js'

/**
 * W3 OpenTrade Action — command dispatch.
 *
 * 16 commands for stablecoin yield vault operations:
 * deposit, redeem, withdrawal completion, balance queries,
 * and vault monitoring.
 *
 * Wallets must be KYC'd and whitelisted by OpenTrade for
 * write operations (deposit, request-redeem, release-withdrawal).
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
  // ── Intent builders (pure — no chain call, no signing) ─────
  //
  // `result` is the full intent object, used by the Explorer's display
  // block for card rendering. The flat per-field outputs (`to`,
  // `chain`, `data_hex`) are for workflow consumption — the W3
  // expression engine reads outputs as strings, so a downstream
  // `${{ steps.build.outputs.result.to }}` does NOT navigate the
  // JSON-encoded result. Flat outputs interpolate cleanly into the
  // ForDefi `data:` block.
  'build-approve': async () => {
    const result = buildApprove({
      vault: core.getInput('vault', { required: true }),
      amount: core.getInput('amount', { required: true }),
      network: core.getInput('network', { required: true }),
      spender: core.getInput('spender') || undefined,
    })
    setJsonOutput('result', result)
    core.setOutput('to', result.to)
    core.setOutput('chain', result.chain)
    core.setOutput('chain_id', String(result.chainId))
    core.setOutput('data_hex', result.data.hex_data)
    core.setOutput('amount', result.amount)
    core.setOutput('amount_formatted', result.amountFormatted)
    core.setOutput('spender', result.spender)
    core.setOutput('vault', result.vault)
  },

  // Fetch live yield metrics from OpenTrade's API for a PoolDynamic
  // (v5) vault. Requires an API key — pass via `api-key` input,
  // typically `${{ secrets.OPENTRADE_API_KEY }}`.
  'get-apy': async () => {
    const result = await getApy({
      vault: core.getInput('vault', { required: true }),
      network: core.getInput('network', { required: true }),
      apiKey: core.getInput('api-key', { required: true }),
      apiBase: core.getInput('api-base') || undefined,
    })
    setJsonOutput('result', result)
    // Flat per-field outputs for downstream display templates and
    // workflow consumption.
    core.setOutput('vault', result.vault)
    core.setOutput('chain', result.chain)
    core.setOutput('date', result.date || '')
    if (result.apy1d != null) core.setOutput('apy_1d', String(result.apy1d))
    if (result.apy7d != null) core.setOutput('apy_7d', String(result.apy7d))
    if (result.apy30d != null) core.setOutput('apy_30d', String(result.apy30d))
    if (result.apySinceInception != null)
      core.setOutput('apy_since_inception', String(result.apySinceInception))
  },

  'build-deposit': async () => {
    const result = buildDeposit({
      vault: core.getInput('vault', { required: true }),
      amount: core.getInput('amount', { required: true }),
      receiver: core.getInput('receiver', { required: true }),
      network: core.getInput('network', { required: true }),
    })
    setJsonOutput('result', result)
    core.setOutput('to', result.to)
    core.setOutput('chain', result.chain)
    core.setOutput('chain_id', String(result.chainId))
    core.setOutput('data_hex', result.data.hex_data)
    core.setOutput('amount', result.amount)
    core.setOutput('amount_formatted', result.amountFormatted)
    core.setOutput('vault', result.vault)
    core.setOutput('receiver', result.receiver)
  },

  'build-request-redeem': async () => {
    const result = buildRequestRedeem({
      vault: core.getInput('vault', { required: true }),
      shares: core.getInput('shares', { required: true }),
      controller: core.getInput('controller', { required: true }),
      owner: core.getInput('owner', { required: true }),
      network: core.getInput('network', { required: true }),
    })
    setJsonOutput('result', result)
    core.setOutput('to', result.to)
    core.setOutput('chain', result.chain)
    core.setOutput('chain_id', String(result.chainId))
    core.setOutput('data_hex', result.data.hex_data)
    core.setOutput('shares', result.shares)
    core.setOutput('vault', result.vault)
    core.setOutput('controller', result.controller)
    core.setOutput('owner', result.owner)
  },

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

  // ── Withdrawal completion ──────────────────────────────────
  'release-withdrawal': async () => {
    const r = await getClient().releaseWithdrawal({
      vault: core.getInput('vault', { required: true }),
      eventId: core.getInput('event-id', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-active-withdraws': async () => {
    const r = await getClient().getActiveWithdraws({
      vault: core.getInput('vault', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-account-state': async () => {
    const r = await getClient().getAccountState({
      vault: core.getInput('vault', { required: true }),
      user: core.getInput('user', { required: true }),
    })
    setJsonOutput('result', r)
  },

  // ── UX read operations ─────────────────────────────────────
  'convert-to-shares': async () => {
    const r = await getClient().convertToShares({
      vault: core.getInput('vault', { required: true }),
      amount: core.getInput('amount', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-interest-rate': async () => {
    const r = await getClient().getInterestRate({
      vault: core.getInput('vault', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-max-deposit': async () => {
    const r = await getClient().getMaxDeposit({
      vault: core.getInput('vault', { required: true }),
      user: core.getInput('user', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'get-max-redeem': async () => {
    const r = await getClient().getMaxRedeem({
      vault: core.getInput('vault', { required: true }),
      user: core.getInput('user', { required: true }),
    })
    setJsonOutput('result', r)
  },

  'preview-redeem': async () => {
    const r = await getClient().previewRedeem({
      vault: core.getInput('vault', { required: true }),
      shares: core.getInput('shares', { required: true }),
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
