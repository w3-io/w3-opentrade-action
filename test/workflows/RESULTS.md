# E2E Test Results

> Last verified: not yet run -- UNVERIFIED (0/13)

## Prerequisites

| Credential / Resource     | Env var                       | Source                              |
| ------------------------- | ----------------------------- | ----------------------------------- |
| W3 bridge endpoint        | `W3_BRIDGE_URL`               | Local `w3 bridge serve` or deployed bridge |
| Avalanche RPC URL         | `W3_CHAIN_RPC_AVALANCHE`      | Any Avalanche C-chain RPC provider  |
| Signer key (writes only)  | `W3_BRIDGE_SIGNER_ETHEREUM`   | A KYC-whitelisted wallet held on the bridge host |

Read-only steps only need the bridge with an Avalanche RPC.
Write steps additionally require a signer that OpenTrade has KYC'd
and whitelisted on the target vault.

## Results

| #   | Step                                  | Command                | Status     | Notes |
| --- | ------------------------------------- | ---------------------- | ---------- | ----- |
| 1   | Get exchange rate                     | `get-exchange-rate`    | UNVERIFIED |       |
| 2   | Get vault info                        | `get-vault-info`       | UNVERIFIED |       |
| 3   | Get pool overview                     | `get-pool-overview`    | UNVERIFIED |       |
| 4   | Get interest rate                     | `get-interest-rate`    | UNVERIFIED |       |
| 5   | Check permission for probe address    | `is-permitted`         | UNVERIFIED |       |
| 6   | Get share balance for probe address   | `get-balance`          | UNVERIFIED |       |
| 7   | Get asset-equivalent balance          | `get-asset-balance`    | UNVERIFIED |       |
| 8   | Get max deposit for probe address     | `get-max-deposit`      | UNVERIFIED |       |
| 9   | Get max redeem for probe address      | `get-max-redeem`       | UNVERIFIED |       |
| 10  | Get account state for probe address   | `get-account-state`    | UNVERIFIED |       |
| 11  | Convert 1 USDC to shares              | `convert-to-shares`    | UNVERIFIED |       |
| 12  | Preview redeeming 1 share unit        | `preview-redeem`       | UNVERIFIED |       |
| 13  | List active async withdrawals        | `get-active-withdraws` | UNVERIFIED |       |

**Summary: 0/13 verified.**

## Skipped Commands

| Command              | Reason                                                      |
| -------------------- | ----------------------------------------------------------- |
| `deposit`            | Requires KYC-whitelisted signer with vault-asset balance    |
| `request-redeem`     | Requires KYC-whitelisted signer holding vault shares        |
| `release-withdrawal` | Requires a settled async withdrawal event ID (PoolFlex)     |

## How to run

```bash
# Start a bridge with an Avalanche RPC (read-only suite)
export W3_CHAIN_RPC_AVALANCHE="https://api.avax.network/ext/bc/C/rpc"
w3 bridge serve --port 8232 --allow '*'

# Point the action at it and run the workflow
export W3_BRIDGE_URL="http://localhost:8232"
w3 workflow test --execute test/workflows/e2e.yaml
```

For write steps, additionally provide a KYC-whitelisted signer to
the bridge:

```bash
w3 bridge serve \
  --port 8232 \
  --allow '*' \
  --signer-ethereum "$W3_SECRET_ETHEREUM"
```
