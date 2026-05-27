/**
 * OpenTrade vault client — stablecoin yield via W3 bridge.
 *
 * OpenTrade vaults are ERC-4626-style contracts that accept stablecoin
 * deposits and generate yield from real-world assets (US Treasuries,
 * money market funds, corporate bonds).
 *
 * Two vault types:
 *   - PoolFlex (v4): Flexible-term T-bills. Deposit/redeem with T+0-2 settlement.
 *   - PoolDynamic (v5): Money market funds. Async redemption (borrower approval).
 *
 * All contract interactions go through bridge.chain() from
 * @w3-io/action-core. No private keys in the action container.
 *
 * Wallets must be KYC'd and whitelisted by OpenTrade before
 * deposit/redeem operations will succeed.
 *
 * Supported networks: ethereum, avalanche, plume
 */

import { W3ActionError } from '@w3-io/action-core'
import { encodeApprove, encodeOpenTradeDeposit, parseUsdcAmount } from './encode.js'

export class OpenTradeError extends W3ActionError {
  constructor(code, message, { details } = {}) {
    super(code, message, { details })
    this.name = 'OpenTradeError'
  }
}

/**
 * Known OpenTrade vault addresses per network.
 * Source: https://docs.opentrade.io
 */
const VAULTS = {
  avalanche: {
    XMMF: '0x09Ca60Ca323a6313aE144778c3EbDfCCFBB5e5D2',
    XFTB: '0x061329361E0f163125225bf71a1E5AF954b46869',
    XTBT: '0xad6605F4987031fd2d6d6816bE53Eb7C5b764bf7',
    XEVT: '0xBFdEf5e389bB403426337081eCD1D05bC5193203',
    XHYC: '0x1D7E71d0CB499C31349DF3E9205A4b16bcCF2536',
  },
  ethereum: {
    XTBT: '0x0f8CbdC544dC1D4Bd1bDafE0039Be07B825aF82A',
    XEVT: '0x3Ee320c9F73a84D1717557af00695A34b26d1F1d',
    XMMF: '0x1e571c87556F216662fa8D25143b1b0618512Ef6',
    'XMMF-USDT': '0xD06f235DF80D4981816F7fB0936973155CDe1f4C',
  },
  plume: {
    XMMF: '0x6688aA2eB549e325C21a16c942827C9c99F40dd9',
    XHYCB: '0xf19d819F23b05C231C0de1dde97289476A0Bcf30',
  },
}

const SUPPORTED_NETWORKS = ['ethereum', 'avalanche', 'plume']

/**
 * Resolve a vault symbol (e.g. "XFTB") or address to a 20-byte hex
 * address on the given network. Exported as a free function so the
 * build-* intent builders can use it without instantiating the
 * bridge-dependent OpenTradeClient.
 */
export function resolveVaultAddress(vault, network) {
  if (!vault) throw new OpenTradeError('MISSING_INPUT', 'vault address or symbol is required')
  if (!network) throw new OpenTradeError('MISSING_INPUT', 'network is required')
  if (vault.startsWith('0x')) return vault
  const map = VAULTS[network] || {}
  const addr = map[vault.toUpperCase()]
  if (!addr) {
    throw new OpenTradeError(
      'INVALID_INPUT',
      `Unknown vault "${vault}" on ${network}. Known: ${Object.keys(map).join(', ')}`,
    )
  }
  return addr
}

/**
 * USDC token addresses per network. Used by build-approve to encode
 * the right approve target. Hard-coded — these are stable Circle
 * deployments, and intent-builder commands should never need a
 * network round-trip to resolve them.
 */
const USDC = {
  avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  plume: '0x78adD880A697070c1e765Ac44D65323a0DcCE913',
}

/**
 * Numeric chain IDs per supported network. Emitted in build-* output
 * so downstream consumers (ForDefi, Safe) can validate the intent
 * targets the chain they think it does.
 */
const CHAIN_IDS = {
  avalanche: 43114,
  ethereum: 1,
  plume: 98865,
}

function requireNetwork(network) {
  if (!network) throw new OpenTradeError('MISSING_INPUT', 'network is required')
  if (!SUPPORTED_NETWORKS.includes(network)) {
    throw new OpenTradeError(
      'UNSUPPORTED_NETWORK',
      `Network "${network}" is not supported. Available: ${SUPPORTED_NETWORKS.join(', ')}`,
    )
  }
}

/** Default OpenTrade API base URL. Override per call for sandbox. */
const OPENTRADE_API_DEFAULT = 'https://api.open-trade.io'

/**
 * Fetch trailing-yield metrics from OpenTrade's public API for a
 * PoolDynamic (v5) vault. Used by the `get-apy` command to surface
 * live APY on the W3 Explorer card. Returns the most recent
 * yieldMetrics row plus a small summary block of the most commonly-
 * displayed APY windows (1-day, 7-day, 30-day, since-inception).
 *
 * Auth: requires an OpenTrade API key (header `x-api-key`). Set via
 * the workflow with `api-key: ${{ secrets.OPENTRADE_API_KEY }}`.
 *
 * Caller is responsible for vault address resolution if passing a
 * symbol — this function only accepts already-resolved addresses or
 * symbols it can look up via `resolveVaultAddress`.
 *
 * Throws an OpenTradeError on auth failure (401/403), invalid vault
 * (400/404), or any non-2xx response. The action's `handleError`
 * surfaces the message verbatim so the demo card shows the real
 * problem rather than "Unknown".
 */
export async function getApy({ vault, network, apiKey, apiBase } = {}) {
  if (!apiKey) {
    throw new OpenTradeError(
      'MISSING_INPUT',
      'api-key is required (pass ${{ secrets.OPENTRADE_API_KEY }})',
    )
  }
  requireNetwork(network)
  const vaultAddr = resolveVaultAddress(vault, network)
  const base = apiBase || OPENTRADE_API_DEFAULT
  const url = `${base.replace(/\/+$/, '')}/poolYieldMetrics/${vaultAddr}`

  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    throw new OpenTradeError(
      'HTTP_ERROR',
      `OpenTrade API network error: ${err && err.message ? err.message : err}`,
    )
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new OpenTradeError(
      'HTTP_ERROR',
      `OpenTrade API ${res.status}: ${body.slice(0, 240)}`,
      { details: { status: res.status, url } },
    )
  }
  const json = await res.json()
  const rows = Array.isArray(json?.yieldMetrics) ? json.yieldMetrics : []
  // Latest row = most recent calculation. The API returns oldest-first
  // by default but we ask for no date range, so it returns the latest
  // single day. Defensive: take the row with the largest dayNumber.
  const latest = rows.reduce(
    (acc, row) => (acc && acc.dayNumber > row.dayNumber ? acc : row),
    null,
  )
  if (!latest) {
    throw new OpenTradeError(
      'NO_DATA',
      `OpenTrade API returned no yieldMetrics for vault ${vaultAddr}`,
    )
  }

  return {
    vault: vaultAddr,
    chain: network,
    chainId: CHAIN_IDS[network],
    date: latest.date,
    calculatedAt: latest.calculatedTimestamp,
    // The most commonly displayed APY windows. All values are
    // decimal (e.g. 0.0521 = 5.21%), matching OpenTrade's response.
    apy1d: latest.yield1DayTrailingAnnualized,
    apy7d: latest.yield7DayTrailingAnnualized,
    apy30d: latest.yield30DayTrailingAnnualized,
    apySinceInception: latest.yieldSinceInceptionAnnualized,
    // Cumulative figures for the same windows (useful for "earned X
    // over the past N days" framing).
    cum1d: latest.yield1DayCumulative,
    cum7d: latest.yield7DayTrailingCumulative,
    cum30d: latest.yield30DayTrailingCumulative,
    // The full row for callers that want every metric the API
    // exposes (YTD, 90d, 12m, calendar-month-completed, etc.).
    raw: latest,
  }
}

/**
 * Build an unsigned exact-amount ERC-20 approve transaction intent
 * for the vault's underlying USDC on the given network. The returned
 * payload is what an external signer (ForDefi, Safe, Fireblocks)
 * consumes — never broadcast by this action. Pure: no chain call,
 * no signer touched.
 *
 * The amount MUST be exact — this builder will never produce a
 * max-uint approve. The spender defaults to the resolved vault
 * address; pass an explicit `spender` to approve a different
 * contract (rare).
 */
export function buildApprove(opts) {
  if (!opts || !opts.amount) {
    throw new OpenTradeError(
      'MISSING_INPUT',
      'amount is required (exact USDC amount, e.g. "40.00"; max-uint approvals are disallowed)',
    )
  }
  requireNetwork(opts.network)
  const vaultAddr = resolveVaultAddress(opts.vault, opts.network)
  const spender = opts.spender || vaultAddr
  if (!/^0x[a-fA-F0-9]{40}$/.test(spender)) {
    throw new OpenTradeError(
      'INVALID_INPUT',
      `spender must be a 20-byte hex address; got "${spender}"`,
    )
  }
  const usdc = USDC[opts.network]
  const amountRaw = parseUsdcAmount(opts.amount)
  const hexData = encodeApprove(spender, amountRaw)

  return {
    intent: 'erc20-approve',
    chain: opts.network,
    chainId: CHAIN_IDS[opts.network],
    to: usdc,
    value: '0',
    data: { type: 'hex', hex_data: hexData },
    selector: hexData.slice(0, 10),
    token: usdc,
    spender,
    vault: vaultAddr,
    amount: amountRaw,
    amountFormatted: opts.amount,
  }
}

/**
 * Build an unsigned ERC-4626 deposit transaction intent against an
 * OpenTrade vault. Returns the {chain, to, value, data} payload an
 * external signer consumes. Pure: no chain call, no signer touched.
 *
 * Caller's responsibility: ensure the resolved `receiver` (the
 * signer's address, typically) has at least `amount` USDC and an
 * existing approval to the vault for `amount` USDC. The companion
 * `buildApprove` command produces the matching exact-amount approve.
 */
export function buildDeposit(opts) {
  if (!opts || !opts.amount) {
    throw new OpenTradeError('MISSING_INPUT', 'amount is required (e.g. "40.00")')
  }
  if (!opts.receiver) {
    throw new OpenTradeError(
      'MISSING_INPUT',
      'receiver is required (the address that will own the resulting vault shares)',
    )
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(opts.receiver)) {
    throw new OpenTradeError(
      'INVALID_INPUT',
      `receiver must be a 20-byte hex address; got "${opts.receiver}"`,
    )
  }
  requireNetwork(opts.network)
  const vaultAddr = resolveVaultAddress(opts.vault, opts.network)
  const amountRaw = parseUsdcAmount(opts.amount)
  const hexData = encodeOpenTradeDeposit(amountRaw, opts.receiver)

  return {
    intent: 'erc4626-deposit',
    chain: opts.network,
    chainId: CHAIN_IDS[opts.network],
    to: vaultAddr,
    value: '0',
    data: { type: 'hex', hex_data: hexData },
    selector: hexData.slice(0, 10),
    vault: vaultAddr,
    underlying: USDC[opts.network],
    amount: amountRaw,
    amountFormatted: opts.amount,
    receiver: opts.receiver,
  }
}

export class OpenTradeClient {
  /**
   * @param {object} options
   * @param {string} options.network - Chain name (ethereum, avalanche, plume)
   * @param {function} options.bridge - The bridge.chain function from @w3-io/action-core
   */
  constructor({ network, bridge } = {}) {
    if (!network) throw new OpenTradeError('MISSING_INPUT', 'network is required')
    if (!bridge) throw new OpenTradeError('MISSING_INPUT', 'bridge function is required')

    if (!SUPPORTED_NETWORKS.includes(network)) {
      throw new OpenTradeError(
        'UNSUPPORTED_NETWORK',
        `Network "${network}" is not supported. Available: ${SUPPORTED_NETWORKS.join(', ')}`,
      )
    }

    this.network = network
    this.bridge = bridge
    this.vaults = VAULTS[network] || {}
  }

  // ── Internal helpers ──────────────────────────────────────────

  async #read(contract, method, args = []) {
    return this.bridge('ethereum', 'read-contract', { contract, method, args }, this.network)
  }

  async #call(contract, method, args = []) {
    return this.bridge('ethereum', 'call-contract', { contract, method, args }, this.network)
  }

  async #approve(token, spender, amount) {
    return this.bridge('ethereum', 'approve-token', { token, spender, amount }, this.network)
  }

  /** Resolve vault address from symbol or address. */
  #resolveVault(vault) {
    return resolveVaultAddress(vault, this.network)
  }

  // ── Write operations ──────────────────────────────────────────

  /**
   * Deposit stablecoins into a vault.
   *
   * Automatically approves the vault to spend the underlying token.
   * The signer's address is derived from the approve receipt.
   *
   * Requires a KYC'd, whitelisted wallet.
   */
  async deposit({ vault, amount } = {}) {
    if (!amount) throw new OpenTradeError('MISSING_INPUT', 'amount is required')
    const vaultAddr = this.#resolveVault(vault)

    // Get the underlying token address
    const underlying = await this.#getUnderlyingAsset(vaultAddr)

    // Approve the vault to spend
    const approveResult = await this.#approve(underlying, vaultAddr, amount)
    const sender = approveResult.from

    // Deposit — both PoolFlex and PoolDynamic accept (assets, lender)
    return this.#call(
      vaultAddr,
      'function deposit(uint256 assets, address lender) returns (uint256)',
      [amount, sender],
    )
  }

  /**
   * Request redemption of vault shares.
   *
   * For PoolFlex: processed T+0 to T+2.
   * For PoolDynamic: async, requires off-chain approval by OpenTrade.
   */
  async requestRedeem({ vault, shares } = {}) {
    if (!shares) throw new OpenTradeError('MISSING_INPUT', 'shares amount is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#call(vaultAddr, 'function requestRedeem(uint256 shares) returns (uint256)', [
      shares,
    ])
  }

  // ── Read operations ───────────────────────────────────────────

  /**
   * Get vault share token balance for a user.
   */
  async getBalance({ vault, user } = {}) {
    if (!user) throw new OpenTradeError('MISSING_INPUT', 'user address is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(vaultAddr, 'function balanceOf(address account) view returns (uint256)', [
      user,
    ])
  }

  /**
   * Get the underlying asset balance equivalent for a user.
   *
   * Converts the user's share balance to the underlying asset amount
   * using the current exchange rate.
   */
  async getAssetBalance({ vault, user } = {}) {
    if (!user) throw new OpenTradeError('MISSING_INPUT', 'user address is required')
    const vaultAddr = this.#resolveVault(vault)

    // Get share balance first
    const shares = await this.#read(
      vaultAddr,
      'function balanceOf(address account) view returns (uint256)',
      [user],
    )
    const shareAmount = shares.result || '0'

    // Convert shares to assets
    return this.#read(
      vaultAddr,
      'function convertToAssets(uint256 shares) view returns (uint256)',
      [shareAmount],
    )
  }

  /**
   * Get the current exchange rate (shares to assets).
   */
  async getExchangeRate({ vault } = {}) {
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(vaultAddr, 'function exchangeRate() view returns (uint256)', [])
  }

  /**
   * Get vault information: pool type, state, underlying asset, rates.
   */
  async getVaultInfo({ vault } = {}) {
    const vaultAddr = this.#resolveVault(vault)

    const [poolType, state, underlying, exchangeRate, totalAssets, name, symbol] =
      await Promise.all([
        this.#read(vaultAddr, 'function poolType() returns (uint8)', []).catch(() => ({
          result: 'unknown',
        })),
        this.#read(vaultAddr, 'function state() view returns (uint8)', []).catch(() => ({
          result: 'unknown',
        })),
        this.#read(vaultAddr, 'function liquidityAssetAddr() view returns (address)', []).catch(
          () => ({ result: 'unknown' }),
        ),
        this.#read(vaultAddr, 'function exchangeRate() view returns (uint256)', []).catch(() => ({
          result: 'unknown',
        })),
        this.#read(vaultAddr, 'function totalAssets() view returns (uint256)', []).catch(() => ({
          result: 'unknown',
        })),
        this.#read(vaultAddr, 'function name() view returns (string)', []).catch(() => ({
          result: 'unknown',
        })),
        this.#read(vaultAddr, 'function symbol() view returns (string)', []).catch(() => ({
          result: 'unknown',
        })),
      ])

    return {
      address: vaultAddr,
      name: name.result,
      symbol: symbol.result,
      poolType: poolType.result,
      state: state.result,
      underlyingAsset: underlying.result,
      exchangeRate: exchangeRate.result,
      totalAssets: totalAssets.result,
    }
  }

  /**
   * Check if an address is whitelisted (permitted lender).
   */
  async isPermitted({ vault, user } = {}) {
    if (!user) throw new OpenTradeError('MISSING_INPUT', 'user address is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(
      vaultAddr,
      'function isPermittedLender(address receiver) view returns (bool)',
      [user],
    )
  }

  /**
   * Get pool overview summary.
   *
   * Reads key metrics: total assets, available assets, exchange rate,
   * and settlement timing.
   */
  async getPoolOverview({ vault } = {}) {
    const vaultAddr = this.#resolveVault(vault)

    const [totalAssets, availableAssets, exchangeRate, pendingWithdrawals] = await Promise.all([
      this.#read(vaultAddr, 'function totalAssets() view returns (uint256)', []).catch(() => ({
        result: '0',
      })),
      this.#read(vaultAddr, 'function totalAvailableAssets() view returns (uint256)', []).catch(
        () => ({ result: '0' }),
      ),
      this.#read(vaultAddr, 'function exchangeRate() view returns (uint256)', []).catch(() => ({
        result: '0',
      })),
      this.#read(
        vaultAddr,
        'function totalAssetsDueForWithdraws() view returns (uint256)',
        [],
      ).catch(() => ({ result: '0' })),
    ])

    return {
      totalAssets: totalAssets.result,
      availableAssets: availableAssets.result,
      exchangeRate: exchangeRate.result,
      pendingWithdrawals: pendingWithdrawals.result,
    }
  }

  // ── Withdrawal completion ──────────────────────────────────────

  /**
   * Release a completed withdrawal from a PoolFlex vault.
   *
   * After request-redeem settles (T+0 to T+2), call this to claim
   * the underlying stablecoins.
   */
  async releaseWithdrawal({ vault, eventId } = {}) {
    if (!eventId) throw new OpenTradeError('MISSING_INPUT', 'eventId is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#call(
      vaultAddr,
      'function releaseWithdrawal(uint256 eventId) returns (uint256)',
      [eventId],
    )
  }

  /**
   * Get active (pending) withdrawal requests for a PoolDynamic vault.
   */
  async getActiveWithdraws({ vault } = {}) {
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(vaultAddr, 'function getActiveWithdraws() view returns (uint256[])', [])
  }

  /**
   * Get full account state for a user.
   *
   * Tries PoolFlex signature first (getPoolAccountState), then
   * falls back to PoolDynamic (getPoolDynamicAccountState).
   */
  async getAccountState({ vault, user } = {}) {
    if (!user) throw new OpenTradeError('MISSING_INPUT', 'user address is required')
    const vaultAddr = this.#resolveVault(vault)

    // Try PoolFlex first
    try {
      return await this.#read(
        vaultAddr,
        'function getPoolAccountState(address account) view returns (tuple)',
        [user],
      )
    } catch {
      // Fall back to PoolDynamic
      return this.#read(
        vaultAddr,
        'function getPoolDynamicAccountState(address account) view returns (tuple)',
        [user],
      )
    }
  }

  // ── UX read operations ───────────────────────────────────────

  /**
   * Convert an asset amount to the equivalent shares.
   *
   * Reverse of convertToAssets (used in get-asset-balance).
   */
  async convertToShares({ vault, amount } = {}) {
    if (!amount) throw new OpenTradeError('MISSING_INPUT', 'amount is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(
      vaultAddr,
      'function convertToShares(uint256 assets) view returns (uint256)',
      [amount],
    )
  }

  /**
   * Get the current interest/yield rate for a vault.
   */
  async getInterestRate({ vault } = {}) {
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(vaultAddr, 'function interestRate() view returns (uint256)', [])
  }

  /**
   * Get the maximum deposit allowed for a user.
   */
  async getMaxDeposit({ vault, user } = {}) {
    if (!user) throw new OpenTradeError('MISSING_INPUT', 'user address is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(
      vaultAddr,
      'function maxDeposit(address receiver) view returns (uint256)',
      [user],
    )
  }

  /**
   * Get the maximum redeemable shares for a user.
   */
  async getMaxRedeem({ vault, user } = {}) {
    if (!user) throw new OpenTradeError('MISSING_INPUT', 'user address is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(
      vaultAddr,
      'function maxRedeemRequest(address owner) view returns (uint256)',
      [user],
    )
  }

  /**
   * Preview the output of a redemption request.
   */
  async previewRedeem({ vault, shares } = {}) {
    if (!shares) throw new OpenTradeError('MISSING_INPUT', 'shares amount is required')
    const vaultAddr = this.#resolveVault(vault)

    return this.#read(
      vaultAddr,
      'function previewRedeemRequest(uint256 shares) view returns (uint256)',
      [shares],
    )
  }

  // ── Private helpers ───────────────────────────────────────────

  async #getUnderlyingAsset(vaultAddr) {
    // Try liquidityAssetAddr first (works on both Flex and Dynamic)
    const result = await this.#read(
      vaultAddr,
      'function liquidityAssetAddr() view returns (address)',
      [],
    )
    const addr = result.result || result
    if (addr && addr !== '0x0000000000000000000000000000000000000000') {
      return addr
    }
    // Fallback to asset() (ERC-4626 standard, only on Dynamic)
    const fallback = await this.#read(vaultAddr, 'function asset() view returns (address)', [])
    return fallback.result || fallback
  }
}
