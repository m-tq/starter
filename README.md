# Octra dApp Starter

Complete dApp starter to test all Octra SDK functions with the OctWa wallet extension.

## Features

### ✅ Connection Management
- Connect to wallet
- Disconnect from wallet
- Display connection info (wallet address, network, branch, epoch)

### ✅ Capability Management
- Request Read capability (get_balance)
- Request Write capability (send_transaction)
- Request Compute capability (invoke_compute)
- Display active capabilities

### ✅ Method Invocation
- Invoke get_balance method
- Test capability-based authorization

### ✅ Message Signing
- Sign arbitrary messages
- Display signature

### ✅ Gas Estimation
- Estimate plain transaction gas
- Display gas units and token cost

## Installation

```bash
cd Sample
npm install
```

## Development

```bash
npm run dev
```

App will run at `http://localhost:3000`

## Testing with Octra Wallet

1. **Install Octra Wallet Extension**
   - Build extension: `cd ../OctWa && npm run build:extension`
   - Load extension from `OctWa/dist` folder

2. **Start dApp**
   ```bash
   npm run dev
   ```

3. **Test Flow**
   - Open `http://localhost:3000`
   - Click "Connect Wallet" - will open wallet popup
   - Approve connection in wallet
   - Request capabilities (Read/Write/Compute)
   - Test invocation methods
   - Test message signing
   - Test gas estimation

## UI/UX Features

Following `BASE_UI_UX.md`:

- ✅ Primary Color: #3A4DFF
- ✅ Privacy Color: #00E5C0
- ✅ Full screen, no overflow
- ✅ Desktop first, responsive
- ✅ No background/shadow on cards
- ✅ Thin separator with dashed border
- ✅ Fixed header & footer
- ✅ Sidebar menu with toggle
- ✅ Hover state with glow shadow
- ✅ Active state with underline
- ✅ Dark/Light theme toggle
- ✅ Lucide React icons
- ✅ Framer Motion transitions
- ✅ Font: Fira Code monospace
- ✅ Sharp edges (no rounded)

## SDK Functions Tested

### Connection
- `OctraSDK.init()` - Initialize SDK
- `sdk.isInstalled()` - Check wallet installation
- `sdk.connect()` - Connect to wallet
- `sdk.disconnect()` - Disconnect from wallet

### Capabilities
- `sdk.requestCapability()` - Request capability with scope (read/write/compute)

### Invocation
- `sdk.invoke()` - Invoke method with capability

### Gas Estimation
- `sdk.estimatePlainTx()` - Estimate plain transaction

### Signing
- `sdk.signMessage()` - Sign arbitrary message

## Project Structure

```
Sample/
├── src/
│   ├── App.tsx           # Main app component with all SDK tests
│   ├── main.tsx          # Entry point
│   ├── index.css         # Global styles with BASE_UI_UX tokens
│   └── vite-env.d.ts     # Type declarations
├── index.html            # HTML template
├── package.json          # Dependencies (SDK path: ../../OctWa/packages/sdk)
├── vite.config.ts        # Vite config
├── tailwind.config.js    # Tailwind config with BASE_UI_UX colors
├── tsconfig.json         # TypeScript config
├── BASE_UI_UX.md         # UI/UX design guidelines
└── README.md             # This file
```

## Dependencies

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Framer Motion** - Animations
- **Lucide React** - Icons
- **@octwa/sdk** - Octra Wallet SDK (linked from ../../OctWa/packages/sdk)

## Build

```bash
npm run build
```

Build output will be in `dist/` folder

## Prerequisites

1. **SDK must be built first**:
   ```bash
   cd ../OctWa/packages/sdk
   npm run build
   ```

2. **Extension must be built and loaded**:
   ```bash
   cd ../OctWa
   npm run build:extension
   ```
   Then load `OctWa/dist` as unpacked extension in Chrome/Edge

## Troubleshooting

**"Wallet Not Found"**
- Ensure OctWa extension is installed and enabled
- Refresh the page after installing extension

**"Connection failed"**
- Check extension is unlocked
- Verify wallet has accounts

**"Cannot find module '@octwa/sdk'"**
- Build SDK: `cd ../OctWa/packages/sdk && npm run build`
- Reinstall: `npm install --force`

**TypeScript errors**
- Ensure vite-env.d.ts exists in src/
- Run `npm run build` to check

## Extension Integration

This dApp tests the complete integration with OctWa extension:

- `extensionFiles/provider.js` - Provider API injected into page
- `extensionFiles/background.js` - Background service worker handling capabilities
- `extensionFiles/content.js` - Content script bridge

All extension files support SDK with:
- Branch-based nonce management
- Epoch tracking
- Capability states (active/expired/revoked)
- HFHE encrypted compute
- Domain separation cryptography

## Notes

- Ensure Octra Wallet extension is installed
- Ensure wallet is unlocked
- All requests will open wallet popup for approval
- Read methods can auto-execute without popup (if capability exists)
- Capabilities expire after TTL (default 900 seconds)
