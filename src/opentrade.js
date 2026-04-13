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
    if (!vault) throw new OpenTradeError('MISSING_INPUT', 'vault address or symbol is required')
    // If it looks like an address, use it directly
    if (vault.startsWith('0x')) return vault
    // Otherwise try to resolve from known vaults
    const addr = this.vaults[vault.toUpperCase()]
    if (!addr) {
      throw new OpenTradeError(
        'INVALID_INPUT',
        `Unknown vault "${vault}" on ${this.network}. Known: ${Object.keys(this.vaults).join(', ')}`,
      )
    }
    return addr
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
