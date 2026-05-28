// Hand-rolled ABI encoder for the calldata shapes this action's
// intent builders produce. All inputs are static types (uint256/
// address), so the encoding is selector + 32-byte-padded args.
//
// Selectors are keccak256("functionName(arg_types)")[:4]. Hard-coded
// here so build-* commands have no chain-call or external-encoding
// dependency.
//
// W3 policy: amounts in approve calls MUST be exact. Never max-uint.

import { W3ActionError } from '@w3-io/action-core'

const SELECTORS = {
  // ERC-20
  approve: '095ea7b3', // approve(address,uint256)
  // ERC-4626 — OpenTrade vaults use the standard signature here.
  // PoolFlex and PoolDynamic both accept `deposit(assets, lender)`.
  deposit: '6e553f65', // deposit(uint256,address)
  // ERC-7540 async redemption — the only redeem entrypoint exposed
  // by OpenTrade v4 PoolFlex. Calling it queues an off-chain
  // settlement; USDC is paid directly to `controller` at T+0 to T+2.
  // There is no on-chain `withdraw`/`redeem` claim step.
  requestRedeem: 'aa2f892d', // requestRedeem(uint256,address,address)
}

function pad32Hex(value) {
  if (typeof value !== 'string') {
    throw new W3ActionError('INVALID_INPUT', `pad32Hex requires hex string; got ${typeof value}`)
  }
  return value.toLowerCase().replace(/^0x/, '').padStart(64, '0')
}

function pad32BigInt(value) {
  let bi
  try {
    bi = BigInt(value)
  } catch {
    throw new W3ActionError('INVALID_INPUT', `pad32BigInt: cannot convert "${value}" to BigInt`)
  }
  if (bi < 0n) {
    throw new W3ActionError(
      'INVALID_INPUT',
      `pad32BigInt: negative values not supported (got ${bi})`,
    )
  }
  return bi.toString(16).padStart(64, '0')
}

/** Encode `approve(spender, amount)`. */
export function encodeApprove(spender, amount) {
  return '0x' + SELECTORS.approve + pad32Hex(spender) + pad32BigInt(amount)
}

/** Encode ERC-4626 `deposit(assets, receiver)` — OpenTrade vault entry. */
export function encodeOpenTradeDeposit(amount, receiver) {
  return '0x' + SELECTORS.deposit + pad32BigInt(amount) + pad32Hex(receiver)
}

/**
 * Encode ERC-7540 `requestRedeem(shares, controller, owner)`. Queues
 * an OpenTrade off-chain settlement; USDC is paid to `controller` at
 * T+0 to T+2 with no on-chain claim step.
 */
export function encodeRequestRedeem(shares, controller, owner) {
  return (
    '0x' + SELECTORS.requestRedeem + pad32BigInt(shares) + pad32Hex(controller) + pad32Hex(owner)
  )
}

/** Convert USDC amount string ("40.00") to base units string ("40000000"). */
export function parseUsdcAmount(amount) {
  if (typeof amount !== 'string') {
    throw new W3ActionError(
      'INVALID_INPUT',
      `amount must be a string (e.g. "40.00"); got ${typeof amount}`,
    )
  }
  const parts = amount.split('.')
  const whole = parts[0] || '0'
  const frac = (parts[1] || '').padEnd(6, '0').slice(0, 6)
  // Strip leading zeros from whole portion but keep at least "0".
  const wholeNorm = whole.replace(/^0+/, '') || '0'
  return wholeNorm + frac
}
