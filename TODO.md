# OpenTrade Action — Test Coverage & Next Steps

## Tested and passing (read-only via bridge)

The standalone bridge script `test/workflows/opentrade-bridge-e2e.sh` exercises four read commands against live Avalanche mainnet:

| #   | Command             | Category | Notes                         |
| --- | ------------------- | -------- | ----------------------------- |
| 1   | `get-exchange-rate` | Read     | XMMF vault                    |
| 2   | `get-vault-info`    | Read     | Returns name, symbol, state   |
| 3   | `get-pool-overview` | Read     | totalAssets / availableAssets |
| 4   | `is-permitted`      | Read     | KYC whitelist probe           |

## Pending verification — workflow harness

`test/workflows/e2e.yaml` covers 13 read steps but has not been run end-to-end. See `test/workflows/RESULTS.md`.

- [ ] Run `w3 workflow test --execute test/workflows/e2e.yaml` and record PASS/FAIL per step in `RESULTS.md`
- [ ] Wire e2e into a `.github/workflows/test.yml` job that runs on push, gated on `W3_CHAIN_RPC_AVALANCHE` secret

## Not yet tested — needs KYC-whitelisted signer (3)

These require a wallet that OpenTrade has KYC'd and whitelisted on the target vault, plus on-chain stablecoin / share balance:

- [ ] `deposit` — needs whitelisted signer with USDC on Avalanche
- [ ] `request-redeem` — needs whitelisted signer holding vault shares
- [ ] `release-withdrawal` — needs a settled async withdrawal event ID from a prior `request-redeem` on a PoolFlex vault

## Cross-network coverage

The bridge script and e2e workflow both target Avalanche XMMF only.

- [ ] Add read-only e2e coverage for Ethereum vaults (XTBT, XEVT, XMMF, XMMF-USDT)
- [ ] Add read-only e2e coverage for Plume vaults (XMMF, XHYCB)
- [ ] Verify symbol-vs-address resolution for each network

## Known gaps

- [ ] `action.yml` description claims 16 commands but lists 15 — reconcile against `src/main.js` handler set
- [ ] No retry/backoff configured on bridge calls — relies on bridge defaults; document the bridge-side knobs
- [ ] No timeout configured on bridge calls — same
- [ ] `get-active-withdraws` is PoolDynamic-only; document that PoolFlex vaults will return an empty list or error

## Documentation

- [ ] Expand `docs/guide.md` with one worked example per command
- [ ] Cross-link `w3-action.yaml` from README so MCP discovery is one click away
- [ ] Add an end-to-end yield-rotation example workflow (`deposit` → wait → `request-redeem` → `release-withdrawal`)

## Tests

- [ ] Unit tests for vault symbol resolution across all networks
- [ ] Unit tests for `OpenTradeError` codes
- [ ] Mock-bridge tests that assert the correct `(contract, method, args)` tuple for each command
