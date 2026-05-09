# Octra dApp Starter

Reference dApp that exercises the full `@octwa/sdk` surface against the OctWa Wallet extension. Uses `@octwa/sdk` **v1.6.0**.

## What's covered

### Connection
- `OctraSDK.init()` · `isInstalled()` · `connect()` · `disconnect()` · `getSessionState()`

### Capability lifecycle
- `requestCapability()` for `read` / `write` / `compute` scopes
- `renewCapability()` · `revokeCapability()` · `listCapabilities()`

### Balance & identity
- `getBalance()` — public + encrypted
- `getEncryptedBalance()` — cipher-only
- `getDecryptedBalance()` — convenience (`getBalance` + `decryptCipher`) in one call
- `getCryptoIdentity()` — Ed25519 pubkey, Curve25519 view pubkey, PVAC registration state

### Transactions
- `invoke({ method: 'send_transaction', ... })` — raw OCT
- `sendContractCall()` — typed contract write
- `sendEvmTransaction()` / `sendErc20Transaction()` — EVM side
- `signMessage()` — "Sign in with Octra"

### Encrypted balance & stealth (HFHE/PVAC)
- `encryptBalance()` / `decryptBalance()` — public ↔ encrypted
- `stealthSend()` / `stealthScan()` / `stealthScanFull()` / `stealthClaim()`
- `computeSharedSecret()` — ECDH with another view pubkey
- `decryptCipher()` / `encryptValue()` — client-side HFHE primitives
- `scanOutputs()` — bulk scan with progress callback
- `keySwitch()` — rotate PVAC key on-chain

### ZK-enabled flows
- `signForZK()` — wallet-signed commitments for Groth16 circuits

### Chain reads (no popup)
- `getTransaction()` · `waitForConfirmation()`
- `getEpoch()` · `getRecommendedFee(opType)`
- `getContractStorage()` · `callContractView()`
- `getViewPubkey()` — resolve another address' view pubkey for stealth sending
- `getEvmTokens()` · `getEvmTokenBalance()`

### Gas
- `estimatePlainTx()` · `estimateEncryptedTx()`

### Events
`connect` · `disconnect` · `capabilityGranted` · `capabilityRevoked` · `capabilityExpired` · `branchChanged` · `epochChanged` · `extensionReady` · `balanceChanged` · `encryptedBalanceChanged` · `stealthOutputFound`

## Install

```bash
npm install
```

The starter depends on `@octwa/sdk@1.6.0` from npm. No linking required.

## Run

```bash
npm run dev
```

The app serves at `http://localhost:3000`. Load the **OctWa Wallet Extension** separately (see the extension's own README) and unlock it before clicking *Connect Wallet*.

## Build

```bash
npm run build
```

Artifacts land in `dist/`.

## UI/UX

Follows the Octrascan visual language baked into `BASE_UI_UX.md`:

- dense, square, scanner-first
- Fira Code for protocol data (addresses, hashes, amounts)
- dark default · light theme toggle
- Framer Motion transitions · Lucide icons
- primary `#3B567F` / private `#00E5C0`

## Troubleshooting

**"Wallet Not Found"**
- Make sure the OctWa extension is installed and enabled, then refresh.

**"Connection failed"**
- Unlock the extension and verify it has at least one account.

**"Cannot find module '@octwa/sdk'"**
- `npm install` again, or pin the version: `npm install @octwa/sdk@1.6.0`.

**Contract call returned 0 amount error**
- SDK ≥1.6.0 handles `amount=0` correctly for `op_type: 'call'`. Bump any older extension builds.

**Reverted calls look successful**
- `octra_transaction(hash)` reports `confirmed` even when a contract call reverted. Read `contract_receipt(hash).success` to detect reverts. The SDK's `waitForConfirmation` plus the starter's `ResponseDecoder.decodeTransaction` surface the correct state.

## Source of truth for SDK details

- Live docs page: https://m-tq.github.io/OctWa (landing, `/sdk` route)
- Package on npm: https://www.npmjs.com/package/@octwa/sdk
- Skill reference in this repo: `.kiro/skills/octwa-sdk/`

## License

MIT
