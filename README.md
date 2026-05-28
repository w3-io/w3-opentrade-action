# W3 OpenTrade Action

Stablecoin yield vaults for W3 workflows. Deposit into US Treasury, money market fund, and corporate bond vaults. Monitor exchange rates, balances, and vault health across Ethereum, Avalanche, and Plume.

## Quick start

```yaml
# Check current exchange rate
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: get-exchange-rate
    network: avalanche
    vault: '0x09Ca60Ca323a6313aE144778c3EbDfCCFBB5e5D2'

# Deposit USDC into the Money Market Fund vault
- uses: w3-io/w3-opentrade-action@v1
  with:
    command: deposit
    network: avalanche
    vault: '0x09Ca60Ca323a6313aE144778c3EbDfCCFBB5e5D2'
    amount: '1000000'
```

## Commands

8 commands across 2 categories:

| Category | Commands |
| --- | --- |
| Write | `deposit`, `request-redeem` |
| Read | `get-balance`, `get-asset-balance`, `get-exchange-rate`, `get-vault-info`, `is-permitted`, `get-pool-overview` |

See [docs/guide.md](docs/guide.md) for per-command reference.

## Networks and vaults

| Network | Vaults |
| --- | --- |
| Avalanche | XMMF (MMF), XFTB (Franklin Templeton), XTBT (Flex USDC), XEVT (Flex EURC), XHYC (High Yield) |
| Ethereum | XTBT, XEVT, XMMF, XMMF-USDT |
| Plume | XMMF, XHYCB |

## KYC requirement

Write operations (deposit, request-redeem) require a KYC'd, whitelisted wallet. Use `is-permitted` to check if an address is whitelisted. Read operations work for any address.

## Authentication

This action is **self-custody** — there are no API keys. Read operations need no credentials; write operations are signed by the W3 bridge using its configured signer.

| Operation | Needs |
| --- | --- |
| Reads | Nothing. `get-exchange-rate`, `get-vault-info`, `get-pool-overview`, `get-balance`, `is-permitted`, etc. just work. |
| Writes | A funded, KYC-whitelisted signer key configured on the bridge (typically via `W3_BRIDGE_SIGNER_ETHEREUM`). The key never enters the action container. |

All on-chain operations go through `bridge.chain()` from `@w3-io/action-core`. The bridge exposes the signer's address as the `from` field on the write operation's result, so workflows can chain `${{ steps.deposit.outputs.result.from }}` into subsequent steps without ever handling the private key.

For local development, start a standalone bridge with `w3 bridge serve --signer-ethereum $W3_SECRET_ETHEREUM --allow '*' --port 8232` and point actions at it via `W3_BRIDGE_URL=http://host.docker.internal:8232`. Set the network RPC via `W3_CHAIN_RPC_AVALANCHE`, `W3_CHAIN_RPC_ETHEREUM`, or `W3_CHAIN_RPC_PLUME` on the bridge process.

## Development

```bash
npm ci
npm run all    # format, lint, test, build
```
