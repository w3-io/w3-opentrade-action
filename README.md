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

## Development

```bash
npm ci
npm run all    # format, lint, test, build
```
