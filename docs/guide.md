# OpenTrade Action Reference

## Inputs

All commands require `command`, `network`, and `vault`.

| Input | Type | Required by | Description |
| --- | --- | --- | --- |
| `command` | string | all | Operation to perform |
| `network` | string | all | Blockchain network (ethereum, avalanche, plume) |
| `vault` | address | all | Vault contract address or symbol (XMMF, XTBT, etc.) |
| `amount` | string | deposit | Amount in underlying asset base units |
| `shares` | string | request-redeem | Amount in vault share tokens |
| `user` | address | get-balance, get-asset-balance, is-permitted, get-account-state, get-max-deposit, get-max-redeem | User address for queries |
| `event-id` | string | release-withdrawal | Withdrawal event ID from request-redeem |

## Output

All commands return a single `result` output as JSON.

Write operations include transaction receipt with `from`, `txHash`, `status`. Read operations return the decoded contract result.

## Vault types

**PoolFlex (T-bills, XTBT/XEVT):** Flexible-term deposits. Redemption settles T+0 to T+2 business days.

**PoolDynamic (MMF, XMMF/XFTB/XHYC):** Money market funds and bond vaults. Redemption is async — requires off-chain approval by OpenTrade's borrower manager.

Both types use the same deposit interface. The difference is in withdrawal timing.

## Commands

### Write operations

#### `deposit`

Deposit stablecoins into a vault. Auto-approves the vault to spend the underlying token. The signer address is derived from the approve receipt.

Requires a KYC'd, whitelisted wallet.

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: deposit
    network: avalanche
    vault: XMMF
    amount: '1000000'
```

#### `request-redeem`

Request redemption of vault shares. For PoolFlex, settles T+0 to T+2. For PoolDynamic, async (OpenTrade processes off-chain).

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: request-redeem
    network: avalanche
    vault: XMMF
    shares: '1000000'
```

### Read operations

#### `get-balance`

Get vault share token balance for a user.

#### `get-asset-balance`

Get the underlying stablecoin equivalent of a user's share balance (accounts for exchange rate).

#### `get-exchange-rate`

Get the current share-to-asset exchange rate. Increases over time as yield accrues.

#### `get-vault-info`

Get vault metadata: name, symbol, pool type, state, underlying asset, exchange rate, total assets.

#### `is-permitted`

Check if an address is whitelisted (KYC'd) for the vault. Returns true/false.

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: is-permitted
    network: avalanche
    vault: XMMF
    user: '0xYourWallet...'
```

#### `get-pool-overview`

Get pool health metrics: total assets, available liquidity, exchange rate, pending withdrawals.

### Withdrawal completion

#### `release-withdrawal`

Release a settled withdrawal from a PoolFlex vault. After `request-redeem` settles (T+0 to T+2), call this to claim the underlying stablecoins.

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: release-withdrawal
    network: avalanche
    vault: XTBT
    event-id: '42'
```

#### `get-active-withdraws`

Get pending async withdrawal requests for a PoolDynamic vault. Returns an array of active withdrawal event IDs.

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: get-active-withdraws
    network: avalanche
    vault: XMMF
```

#### `get-account-state`

Get full user position: shares, assets, pending withdrawals. Tries PoolFlex (`getPoolAccountState`) first, falls back to PoolDynamic (`getPoolDynamicAccountState`).

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: get-account-state
    network: avalanche
    vault: XMMF
    user: '0xYourWallet...'
```

### UX helpers

#### `convert-to-shares`

Convert an asset amount to the equivalent vault shares (reverse of `get-asset-balance`).

#### `get-interest-rate`

Get the current yield/interest rate for a vault.

#### `get-max-deposit`

Get the maximum deposit allowed for a user.

#### `get-max-redeem`

Get the maximum redeemable shares for a user.

#### `preview-redeem`

Preview the output of a redemption request before submitting.

```yaml
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: preview-redeem
    network: avalanche
    vault: XMMF
    shares: '1000000'
```

## Vault addresses

### Avalanche

| Vault                     | Symbol | Address                                      |
| ------------------------- | ------ | -------------------------------------------- |
| USD Money Market Fund     | XMMF   | `0x09Ca60Ca323a6313aE144778c3EbDfCCFBB5e5D2` |
| Franklin Templeton Benji  | XFTB   | `0x061329361E0f163125225bf71a1E5AF954b46869` |
| Flexible Term USDC        | XTBT   | `0xad6605F4987031fd2d6d6816bE53Eb7C5b764bf7` |
| Flexible Term EURC        | XEVT   | `0xBFdEf5e389bB403426337081eCD1D05bC5193203` |
| High Yield Corporate Bond | XHYC   | `0x1D7E71d0CB499C31349DF3E9205A4b16bcCF2536` |

### Ethereum

| Vault                 | Symbol    | Address                                      |
| --------------------- | --------- | -------------------------------------------- |
| Flexible Term USDC    | XTBT      | `0x0f8CbdC544dC1D4Bd1bDafE0039Be07B825aF82A` |
| Flexible Term EURC    | XEVT      | `0x3Ee320c9F73a84D1717557af00695A34b26d1F1d` |
| USD Money Market Fund | XMMF      | `0x1e571c87556F216662fa8D25143b1b0618512Ef6` |
| USD MMF (USDT)        | XMMF-USDT | `0xD06f235DF80D4981816F7fB0936973155CDe1f4C` |

### Plume

| Vault                     | Symbol | Address                                      |
| ------------------------- | ------ | -------------------------------------------- |
| USD Money Market Fund     | XMMF   | `0x6688aA2eB549e325C21a16c942827C9c99F40dd9` |
| High Yield Corporate Bond | XHYCB  | `0xf19d819F23b05C231C0de1dde97289476A0Bcf30` |

## Error codes

| Code                   | Meaning                                                |
| ---------------------- | ------------------------------------------------------ |
| `MISSING_INPUT`        | A required input was not provided                      |
| `INVALID_INPUT`        | Unknown vault symbol or malformed input                |
| `UNSUPPORTED_NETWORK`  | Network not supported                                  |
| `PROVIDER_ERROR`       | RPC communication failed                               |
| `REVERTED`             | On-chain transaction reverted (likely not whitelisted) |
| `BRIDGE_NOT_AVAILABLE` | W3 bridge is not reachable                             |
