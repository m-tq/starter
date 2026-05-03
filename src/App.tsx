import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet, Shield, Send, FileText, Zap,
  Moon, Sun, CheckCircle, XCircle, Loader2,
  RefreshCw, AlertTriangle, X, Copy, CheckCheck,
  Eye, EyeOff, Lock, Coins, ArrowRightLeft,
} from 'lucide-react';
import { OctraSDK } from '@octwa/sdk';
import type { Connection, Capability, BalanceResponse, SignMessageResult, EncryptedBalanceInfo, GetEvmTokensResult } from '@octwa/sdk';
import {
  logger,
  validateConnection,
  validateCapability,
  validateBalance,
  validateError,
  testCanonicalSerialization,
  testDomainSeparation,
} from './debug-utils';
import { ResponseDecoder } from './response-decoder';
import { withRetry, withTimeout, CircuitBreaker } from './error-handler';
import { HFHE_CIRCUITS, createComputeRequest, simulateComputeResult, estimateCircuitCost } from './hfhe-utils';

// ── Logo ──────────────────────────────────────────────────────────────────────
const Logo = ({ size = 24 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size}>
    <circle cx="32" cy="32" r="30" fill="#3B567F"/>
    <path d="M16 22C16 20.3431 17.3431 19 19 19H45C46.6569 19 48 20.3431 48 22V24H16V22Z" fill="white" opacity="0.9"/>
    <rect x="16" y="24" width="32" height="20" rx="2" fill="white"/>
    <rect x="20" y="28" width="24" height="3" rx="1.5" fill="#3B567F" opacity="0.3"/>
    <rect x="20" y="33" width="16" height="3" rx="1.5" fill="#3B567F" opacity="0.3"/>
    <circle cx="40" cy="38" r="3.5" fill="#3B567F"/>
    <circle cx="40" cy="38" r="1.5" fill="white"/>
  </svg>
);

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className={`hover:opacity-70 transition-opacity ${className}`} title="Copy">
      {copied ? <CheckCheck className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

// ── Result box ────────────────────────────────────────────────────────────────
function ResultBox({ result, loading }: { result: string; loading?: boolean }) {
  if (!result && !loading) return null;
  return (
    <div className="p-3 border border-border bg-muted/20 text-xs font-mono whitespace-pre-wrap break-all">
      {loading ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Running...
        </span>
      ) : result}
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(title: string, description: string) {
  const el = document.createElement('div');
  el.className = 'fixed bottom-4 right-4 bg-background border border-border shadow-lg p-4 max-w-sm z-50 text-sm';
  el.innerHTML = `<div class="font-semibold mb-1">${title}</div><div class="text-xs text-muted-foreground">${description}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Main App ──────────────────────────────────────────────────────────────────
function App() {
  const [sdk, setSdk] = useState<OctraSDK | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSection, setActiveSection] = useState('about');

  // Result states per section
  const [balanceResult, setBalanceResult] = useState('');
  const [encBalanceResult, setEncBalanceResult] = useState('');
  const [signResult, setSignResult] = useState('');
  const [evmTokensResult, setEvmTokensResult] = useState('');
  const [gasResult, setGasResult] = useState('');
  const [advancedResult, setAdvancedResult] = useState('');
  const [demoResult, setDemoResult] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [circuitBreaker] = useState(() => new CircuitBreaker(3, 30000));

  // Read cap ref — reused for balance fetches
  const readCapRef = useRef<Capability | null>(null);

  useEffect(() => { initSDK(); }, []);

  const initSDK = async () => {
    try {
      logger.group('SDK Initialization');
      const octraSDK = await OctraSDK.init({ timeout: 3000 });
      setSdk(octraSDK);
      setIsInstalled(octraSDK.isInstalled());
      logger.success('SDK v1.3.4 initialized');
      logger.groupEnd();
      testCanonicalSerialization();
      testDomainSeparation();
    } catch (err) {
      logger.error('SDK initialization failed', err);
      logger.groupEnd();
    }
  };

  const handleConnect = async () => {
    if (!sdk) return;
    setLoading('connect');
    try {
      logger.group('Connection Request');
      const conn = await sdk.connect({
        circle: 'octwa_dapp_starter',
        appOrigin: window.location.origin,
      });
      logger.success('Connected', conn);
      validateConnection(conn);
      setConnection(conn);
      logger.groupEnd();
    } catch (err: unknown) {
      logger.error('Connection failed', err);
      validateError(err);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleDisconnect = async () => {
    if (!sdk) return;
    setLoading('disconnect');
    try {
      await sdk.disconnect();
      setConnection(null);
      setCapabilities([]);
      readCapRef.current = null;
    } catch { /* ignore */ }
    finally { setLoading(null); }
  };

  const handleRequestCapability = async (scope: 'read' | 'write') => {
    if (!sdk || !connection) return;
    setLoading(`capability-${scope}`);
    try {
      logger.group(`Capability Request (${scope})`);
      const methods = scope === 'read'
        ? ['get_balance', 'get_encrypted_balance', 'stealth_scan', 'get_evm_tokens', 'get_evm_token_balance']
        : ['send_transaction', 'send_evm_transaction', 'send_erc20_transaction', 'encrypt_balance', 'decrypt_balance', 'stealth_send', 'stealth_claim'];

      const cap = await sdk.requestCapability({
        circle: 'octwa_dapp_starter',
        methods,
        scope,
        encrypted: false,
        ttlSeconds: 900,
      });
      logger.success('Capability granted', cap);
      validateCapability(cap);
      if (scope === 'read') readCapRef.current = cap;
      setCapabilities(prev => [...prev, cap]);
      logger.groupEnd();
    } catch (err: unknown) {
      logger.error('Capability request failed', err);
      validateError(err);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  // ── Phase 2: getBalance ───────────────────────────────────────────────────
  const handleGetBalance = async () => {
    if (!sdk) return;
    setLoading('balance');
    setBalanceResult('');
    try {
      const readCap = readCapRef.current ?? capabilities.find(c => c.scope === 'read');
      if (!readCap) { setBalanceResult('Error: No read capability. Request one first.'); return; }

      const bal: BalanceResponse = await sdk.getBalance(readCap.id);
      validateBalance(bal);
      setBalanceResult(
        `OCT Address : ${bal.octAddress}\n` +
        `OCT Balance : ${bal.octBalance} OCT\n` +
        `Enc Balance : ${bal.encryptedBalance} OCT\n` +
        `Has PVAC    : ${bal.hasPvacPubkey}\n` +
        `Cipher      : ${bal.cipher.slice(0, 40)}...\n` +
        `Network     : ${bal.network}`
      );
    } catch (err: unknown) {
      setBalanceResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Phase 4: getEncryptedBalance ──────────────────────────────────────────
  const handleGetEncryptedBalance = async () => {
    if (!sdk) return;
    setLoading('enc-balance');
    setEncBalanceResult('');
    try {
      const readCap = readCapRef.current ?? capabilities.find(c => c.scope === 'read');
      if (!readCap) { setEncBalanceResult('Error: No read capability. Request one first.'); return; }

      const info: EncryptedBalanceInfo = await sdk.getEncryptedBalance(readCap.id);
      setEncBalanceResult(
        `Encrypted Balance : ${info.encryptedBalance} OCT\n` +
        `Has PVAC Key      : ${info.hasPvacPubkey}\n` +
        `Cipher            : ${info.cipher.slice(0, 60)}...`
      );
    } catch (err: unknown) {
      setEncBalanceResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Phase 1: signMessage ──────────────────────────────────────────────────
  const handleSignMessage = async () => {
    if (!sdk || !connection) return;
    setLoading('sign');
    setSignResult('');
    try {
      const result: SignMessageResult = await sdk.signMessage('Sign in to OctWa dApp Starter');
      setSignResult(
        `Message   : ${result.message}\n` +
        `Address   : ${result.address}\n` +
        `Signature : ${result.signature.slice(0, 64)}...`
      );
      showToast('Message Signed', `Sig: ${result.signature.slice(0, 16)}...`);
    } catch (err: unknown) {
      setSignResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Phase 9: getEvmTokens ─────────────────────────────────────────────────
  const handleGetEvmTokens = async () => {
    if (!sdk) return;
    setLoading('evm-tokens');
    setEvmTokensResult('');
    try {
      const readCap = readCapRef.current ?? capabilities.find(c => c.scope === 'read');
      if (!readCap) { setEvmTokensResult('Error: No read capability. Request one first.'); return; }

      const result: GetEvmTokensResult = await sdk.getEvmTokens(readCap.id);
      const lines = [
        `Network  : ${result.networkId}`,
        `Chain ID : ${result.chainId}`,
        `Tokens   : ${result.tokens.length}`,
        '',
        ...result.tokens.map(t =>
          `  ${t.symbol.padEnd(8)} ${t.balance.padStart(16)} — ${t.address}`
        ),
      ];
      setEvmTokensResult(lines.join('\n') || 'No tokens found.');
    } catch (err: unknown) {
      setEvmTokensResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Phase 3: sendEvmTransaction (demo) ────────────────────────────────────
  const handleSendTransaction = async () => {
    if (!sdk || !connection) return;
    setLoading('write');
    try {
      const writeCap = capabilities.find(c => c.scope === 'write');
      if (!writeCap) { showToast('Error', 'No write capability. Request one first.'); return; }

      const payloadBytes = new TextEncoder().encode(JSON.stringify({
        to: 'oct8UYokvM1DR2QpEVM7oCLvJLPvJqvvvvvvvvvvvvvvvvvvv',
        amount: 0.001,
        message: 'Test from OctWa dApp Starter v1.3.4',
      }));

      const result = await sdk.invoke({
        capabilityId: writeCap.id,
        method: 'send_transaction',
        payload: payloadBytes,
      });

      if (result.success) {
        const decoded = ResponseDecoder.safeDecode<{ txHash?: string }>(result, {});
        showToast('Transaction Sent', `TX: ${decoded.txHash?.slice(0, 16) ?? 'submitted'}...`);
      }
    } catch (err: unknown) {
      showToast('Transaction Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  // ── Gas estimation ────────────────────────────────────────────────────────
  const handleEstimateGas = async () => {
    if (!sdk) return;
    setLoading('gas');
    setGasResult('');
    try {
      const [standard, encrypted] = await Promise.all([
        sdk.estimatePlainTx({}),
        sdk.estimateEncryptedTx({ scheme: 'HFHE', data: new Uint8Array(8), associatedData: 'sample' }),
      ]);
      const fmt = (ou: number) => `${ou.toLocaleString()} OU  =  ${(ou / 1_000_000).toFixed(7)} OCT`;
      setGasResult(
        `Live fee estimates (octra_recommendedFee)\n${'─'.repeat(44)}\n\n` +
        `standard (plain transfer)\n  Fee: ${fmt(standard.gasUnits)}\n  Epoch: ${standard.epoch}\n\n` +
        `encrypt  (HFHE encrypted tx)\n  Fee: ${fmt(encrypted.gasUnits)}\n  Epoch: ${encrypted.epoch}`
      );
    } catch (err: unknown) {
      setGasResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  // ── Advanced: list / renew / revoke ──────────────────────────────────────
  const handleListCapabilities = async () => {
    if (!sdk) return;
    setLoading('list-caps');
    setAdvancedResult('');
    try {
      const caps = await sdk.listCapabilities();
      setAdvancedResult(
        `Found ${caps.length} capabilities:\n` +
        caps.map((c, i) =>
          `${i + 1}. ${c.id}\n   scope: ${c.scope}  state: ${c.state}\n   methods: ${c.methods.join(', ')}`
        ).join('\n\n')
      );
    } catch (err: unknown) {
      setAdvancedResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  const handleRenewCapability = async () => {
    if (!sdk || capabilities.length === 0) return;
    setLoading('renew-cap');
    try {
      const renewed = await sdk.renewCapability(capabilities[0].id);
      setCapabilities(prev => prev.map(c => c.id === renewed.id ? renewed : c));
      showToast('Capability Renewed', `Expires: ${new Date(renewed.expiresAt).toLocaleString()}`);
    } catch (err: unknown) {
      showToast('Renew Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const handleRevokeCapability = async () => {
    if (!sdk || capabilities.length === 0) return;
    setLoading('revoke-cap');
    try {
      const cap = capabilities[capabilities.length - 1];
      await sdk.revokeCapability(cap.id);
      setCapabilities(prev => prev.filter(c => c.id !== cap.id));
      if (readCapRef.current?.id === cap.id) readCapRef.current = null;
      showToast('Capability Revoked', `Revoked ${cap.scope} capability`);
    } catch (err: unknown) {
      showToast('Revoke Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  // ── Demo: retry ───────────────────────────────────────────────────────────
  const handleDemoRetry = async () => {
    setLoading('demo-retry');
    setDemoResult('');
    setRetryCount(0);
    try {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        if (attempts < 3) throw Object.assign(new Error('Simulated network error'), { code: 'NETWORK_ERROR', retryable: true });
        return { data: 'Operation succeeded!' };
      }, {
        maxAttempts: 5, delayMs: 500, backoffMultiplier: 2,
        onRetry: (attempt) => setRetryCount(attempt),
      });
      setDemoResult(`[SUCCESS] Retry Demo\nAttempts: ${attempts}\nResult: ${result.data}\nStrategy: exponential backoff 500ms → 1s → 2s`);
    } catch (err: unknown) {
      setDemoResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  const handleDemoCircuitBreaker = async () => {
    setLoading('demo-circuit');
    setDemoResult('');
    try {
      const result = await circuitBreaker.execute(async () => {
        await new Promise(r => setTimeout(r, 100));
        return { message: 'Operation completed' };
      });
      setDemoResult(`[SUCCESS] Circuit Breaker\nState: ${circuitBreaker.getState()}\nResult: ${result.message}`);
    } catch (err: unknown) {
      setDemoResult(`Error: ${err instanceof Error ? err.message : String(err)}\nState: ${circuitBreaker.getState()}`);
    } finally {
      setLoading(null);
    }
  };

  const handleDemoTimeout = async () => {
    setLoading('demo-timeout');
    setDemoResult('');
    try {
      const result = await withTimeout(async () => {
        await new Promise(r => setTimeout(r, 500));
        return 'Fast operation completed';
      }, 2000, 'Operation timed out after 2s');
      setDemoResult(`[SUCCESS] Timeout Demo\nTimeout: 2000ms\nActual: ~500ms\nResult: ${result}`);
    } catch (err: unknown) {
      setDemoResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  const handleDemoHFHECircuit = async (circuitKey: keyof typeof HFHE_CIRCUITS) => {
    setLoading(`demo-hfhe-${circuitKey}`);
    setDemoResult('');
    try {
      const input = circuitKey === 'SIMPLE_ADD' ? [5, 10] : circuitKey === 'MULTIPLY' ? [3, 7] :
                    circuitKey === 'COMPARISON' ? [15, 10] : circuitKey === 'POLYNOMIAL' ? [4] : [0.5];
      const computeReq = createComputeRequest(circuitKey, input);
      const computeResult = simulateComputeResult(circuitKey, input);
      const cost = estimateCircuitCost(circuitKey);
      setDemoResult(
        `[SUCCESS] HFHE: ${HFHE_CIRCUITS[circuitKey].name}\n` +
        `Input: [${input.join(', ')}]  Encrypted: ${computeReq.encryptedInput.data.length} bytes\n` +
        `Gates: ${computeReq.computeProfile.gateCount}  Depth: ${computeReq.computeProfile.depth}\n` +
        `Gas: ${computeResult.gasUsed} OU = ${cost.tokenCost.toFixed(7)} OCT\n` +
        `Time: ${computeResult.executionTime.toFixed(1)}ms\n` +
        `Result: ${computeResult.plainResult}`
      );
    } catch (err: unknown) {
      setDemoResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  };

  const sections = [
    { id: 'about',        label: 'About',           icon: FileText },
    { id: 'connection',   label: 'Connection',       icon: Wallet },
    { id: 'capabilities', label: 'Capabilities',     icon: Shield },
    { id: 'invocation',   label: 'Invocation',       icon: Send },
    { id: 'evm',          label: 'EVM & Tokens',     icon: Coins },
    { id: 'private',      label: 'Private Balance',  icon: Lock },
    { id: 'gas',          label: 'Gas Estimation',   icon: Zap },
    { id: 'advanced',     label: 'Advanced',         icon: RefreshCw },
    { id: 'demo',         label: 'Feature Demos',    icon: Zap },
  ];

  const readCap  = readCapRef.current ?? capabilities.find(c => c.scope === 'read');
  const writeCap = capabilities.find(c => c.scope === 'write');

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden font-mono">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background">
          <div className="flex items-center justify-between px-3 md:px-6 py-3">
            <div className="flex items-center gap-2">
              <Logo size={24} />
              <h1 className="text-sm md:text-base font-bold" style={{ color: '#3B567F' }}>
                <span className="hidden sm:inline">OctWa dApp Starter</span>
                <span className="sm:hidden">OctWa</span>
              </h1>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">v1.3.4</span>
            </div>

            <div className="flex items-center gap-2">
              {connection ? (
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex flex-col items-end gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-foreground">
                        {connection.walletPubKey.slice(0, 8)}...{connection.walletPubKey.slice(-4)}
                      </span>
                      <CopyButton text={connection.walletPubKey} />
                    </div>
                    {connection.evmAddress && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {connection.evmAddress.slice(0, 6)}...{connection.evmAddress.slice(-4)}
                        </span>
                        <CopyButton text={connection.evmAddress} />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleDisconnect}
                    disabled={loading === 'disconnect'}
                    className="px-2 md:px-3 py-1.5 border border-input bg-background disabled:opacity-50 hover:opacity-80 transition-opacity flex items-center gap-1 text-xs"
                  >
                    {loading === 'disconnect' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                    <span className="hidden sm:inline">Disconnect</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={!isInstalled || loading === 'connect'}
                  className="px-3 py-1.5 bg-[#3B567F] text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-1 text-xs"
                >
                  {loading === 'connect' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
                  <span className="hidden sm:inline">Connect</span>
                </button>
              )}
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="p-1.5 hover:opacity-70 transition-opacity"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1 pt-12 overflow-hidden">
          {/* Mobile overlay */}
          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <aside className={`fixed left-0 top-12 bottom-0 w-56 border-r border-border bg-background transition-transform overflow-y-auto z-40 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute -right-7 top-4 px-1.5 py-3 border border-border bg-background hover:opacity-80 transition-opacity text-[10px] hidden md:block"
            >
              {sidebarOpen ? '‹' : '›'}
            </button>
            <button onClick={() => setSidebarOpen(false)} className="absolute right-2 top-2 p-1.5 hover:bg-muted md:hidden">
              <X className="w-4 h-4" />
            </button>
            <nav className="p-3 space-y-0.5 pt-4">
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setActiveSection(id); if (window.innerWidth < 768) setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-all ${
                    activeSection === id
                      ? 'text-[#3B567F] border-l-2 border-[#3B567F] pl-[10px]'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </nav>
          </aside>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <main className={`flex-1 transition-all ${sidebarOpen ? 'md:ml-56' : 'ml-0'} overflow-y-auto`}>
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="fixed bottom-4 right-4 p-3 bg-[#3B567F] text-white shadow-lg md:hidden z-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>

            <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-6">

              {/* ── ABOUT ──────────────────────────────────────────────── */}
              {activeSection === 'about' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5" /> About OctWa dApp Starter
                  </h2>

                  <p className="text-xs text-muted-foreground">
                    Reference implementation for integrating a dApp with Octra blockchain via{' '}
                    <span className="font-mono text-foreground">@octwa/sdk v1.3.4</span> and the OctWa Wallet Extension.
                    Private keys never leave the extension.
                  </p>

                  {/* API table */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-[#3B567F] uppercase tracking-wide">SDK Methods (v1.3.4)</h3>
                    <div className="space-y-0.5">
                      {[
                        ['init(options?)',                    '—',       '—',      'Detect extension, return SDK instance'],
                        ['connect(request)',                  'popup',   '—',      'Open connection → Connection object'],
                        ['disconnect()',                      '—',       '—',      'Clear session and capabilities'],
                        ['requestCapability(req)',            'popup',   '—',      'Request scoped permission token'],
                        ['renewCapability(id)',               '—',       '—',      'Extend capability TTL by 15 min'],
                        ['revokeCapability(id)',              '—',       '—',      'Immediately revoke capability'],
                        ['listCapabilities()',                '—',       '—',      'List all active capabilities'],
                        ['invoke(req)',                       'write',   'any',    'Low-level signed invocation'],
                        ['signMessage(msg)',                  'popup',   '—',      'Ed25519 sign arbitrary message'],
                        ['getBalance(capId)',                 'auto',    'read',   'OCT + encrypted balance + cipher'],
                        ['getEncryptedBalance(capId)',        'auto',    'read',   'Cipher + PVAC key status'],
                        ['encryptBalance(capId, amount)',     'popup',   'write',  'Move OCT → encrypted balance'],
                        ['decryptBalance(capId, amount)',     'popup',   'write',  'Move encrypted balance → OCT'],
                        ['stealthSend(capId, payload)',       'popup',   'write',  'Private transfer from enc balance'],
                        ['stealthScan(capId)',                'auto',    'read',   'Scan for claimable stealth outputs'],
                        ['stealthClaim(capId, outputId)',     'popup',   'write',  'Claim stealth output'],
                        ['sendEvmTransaction(capId, p)',      'popup',   'write',  'Send ETH tx via wallet secp256k1'],
                        ['sendErc20Transaction(capId, p)',    'popup',   'write',  'Send ERC-20 token transfer'],
                        ['sendContractCall(capId, p)',        'popup',   'write',  'Typed Octra contract call'],
                        ['getEvmTokens(capId)',               'auto',    'read',   'All ERC-20 balances for active EVM network'],
                        ['getEvmTokenBalance(capId, addr)',   'auto',    'read',   'Single ERC-20 token balance'],
                        ['estimatePlainTx(payload)',          '—',       '—',      'Live fee: octra_recommendedFee("standard")'],
                        ['estimateEncryptedTx(payload)',      '—',       '—',      'Live fee: octra_recommendedFee("encrypt")'],
                        ['getSessionState()',                 '—',       '—',      'Connection + active capabilities'],
                        ['on(event, cb)',                     '—',       '—',      'connect, disconnect, capabilityGranted, branchChanged, epochChanged'],
                      ].map(([name, popup, scope, desc]) => (
                        <div key={name} className="flex gap-2 text-[10px] py-0.5 border-b border-dashed border-border/50">
                          <span className="font-mono text-[#3B567F] w-52 flex-shrink-0">{name}</span>
                          <span className={`w-10 flex-shrink-0 ${popup === 'popup' ? 'text-orange-500' : popup === 'auto' ? 'text-blue-500' : 'text-muted-foreground'}`}>{popup}</span>
                          <span className={`w-10 flex-shrink-0 ${scope === 'read' ? 'text-green-500' : scope === 'write' ? 'text-orange-500' : 'text-muted-foreground'}`}>{scope}</span>
                          <span className="text-muted-foreground">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border border-dashed border-border p-3 text-[10px] text-muted-foreground space-y-1">
                    <p>SDK: <span className="text-foreground font-mono">@octwa/sdk@1.3.4</span></p>
                    <p>Networks: <span className="text-foreground">mainnet / devnet</span></p>
                    <p>EVM network: <span className="text-foreground">auto-resolved from wallet settings</span></p>
                    <p>License: <span className="text-foreground">MIT</span></p>
                    <a href="https://github.com/m-tq/OctWa" className="text-[#3B567F] hover:underline">github.com/m-tq/OctWa</a>
                  </div>
                </motion.div>
              )}

              {/* ── CONNECTION ─────────────────────────────────────────── */}
              {activeSection === 'connection' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Wallet className="w-5 h-5" /> Connection</h2>

                  <div className="flex items-center gap-2 text-sm">
                    {isInstalled
                      ? <><CheckCircle className="w-4 h-4 text-green-500" /><span>OctWa extension detected</span></>
                      : <><XCircle className="w-4 h-4 text-destructive" /><span>Extension not found — install OctWa</span></>
                    }
                  </div>

                  {connection && (
                    <div className="border border-border p-3 space-y-2 text-xs">
                      {[
                        ['Circle',       connection.circle],
                        ['Network',      connection.network],
                        ['EVM Network',  connection.evmNetworkId],
                        ['Epoch',        String(connection.epoch)],
                        ['Branch',       connection.branchId],
                        ['Session',      connection.sessionId],
                      ].map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-4">
                          <span className="text-muted-foreground flex-shrink-0">{label}</span>
                          <span className="font-mono text-right break-all">{value}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-4 pt-1 border-t border-dashed border-border">
                        <span className="text-muted-foreground flex-shrink-0">Octra Address</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[10px] break-all">{connection.walletPubKey}</span>
                          <CopyButton text={connection.walletPubKey} />
                        </div>
                      </div>
                      {connection.evmAddress && (
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground flex-shrink-0">EVM Address</span>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10px] break-all">{connection.evmAddress}</span>
                            <CopyButton text={connection.evmAddress} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!connection && isInstalled && (
                    <p className="text-xs text-muted-foreground">Click "Connect" in the header to establish connection.</p>
                  )}
                </motion.div>
              )}

              {/* ── CAPABILITIES ───────────────────────────────────────── */}
              {activeSection === 'capabilities' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5" /> Capabilities</h2>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleRequestCapability('read')}
                      disabled={!connection || !!loading}
                      className="px-4 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'capability-read' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      Request Read
                    </button>
                    <button
                      onClick={() => handleRequestCapability('write')}
                      disabled={!connection || !!loading}
                      className="px-4 py-2 bg-orange-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'capability-write' ? <Loader2 className="w-3 h-3 animate-spin" /> : <EyeOff className="w-3 h-3" />}
                      Request Write
                    </button>
                  </div>

                  {capabilities.length > 0 && (
                    <div className="space-y-2">
                      {capabilities.map(cap => (
                        <div key={cap.id} className="border border-border p-3 text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">ID</span>
                            <div className="flex items-center gap-1">
                              <span className="font-mono">{cap.id.slice(0, 20)}...</span>
                              <CopyButton text={cap.id} />
                            </div>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Scope</span>
                            <span className={`font-mono ${cap.scope === 'read' ? 'text-green-500' : 'text-orange-500'}`}>{cap.scope}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">State</span>
                            <span className="font-mono">{cap.state}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Methods</span>
                            <span className="font-mono text-right text-[10px]">{cap.methods.join(', ')}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Expires</span>
                            <span className="font-mono">{new Date(cap.expiresAt).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ── INVOCATION ─────────────────────────────────────────── */}
              {activeSection === 'invocation' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Send className="w-5 h-5" /> Invocation</h2>

                  {/* getBalance */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-green-600 dark:text-green-400">getBalance() — auto-execute, read</h3>
                    <button
                      onClick={handleGetBalance}
                      disabled={!readCap || loading === 'balance'}
                      className="px-4 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'balance' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
                      Get Balance
                    </button>
                    <ResultBox result={balanceResult} loading={loading === 'balance' && !balanceResult} />
                  </div>

                  {/* signMessage */}
                  <div className="space-y-2 border-t border-dashed border-border pt-4">
                    <h3 className="text-xs font-semibold text-[#3B567F]">signMessage() — popup, no capability needed</h3>
                    <button
                      onClick={handleSignMessage}
                      disabled={!connection || loading === 'sign'}
                      className="px-4 py-2 bg-[#3B567F] text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'sign' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                      Sign Message
                    </button>
                    <ResultBox result={signResult} loading={loading === 'sign' && !signResult} />
                  </div>

                  {/* sendTransaction */}
                  <div className="space-y-2 border-t border-dashed border-border pt-4">
                    <h3 className="text-xs font-semibold text-orange-600 dark:text-orange-400">send_transaction — popup, write</h3>
                    <button
                      onClick={handleSendTransaction}
                      disabled={!writeCap || loading === 'write'}
                      className="px-4 py-2 bg-orange-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'write' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Send Transaction (0.001 OCT demo)
                    </button>
                    {!writeCap && <p className="text-[10px] text-muted-foreground">Request a write capability first.</p>}
                  </div>
                </motion.div>
              )}

              {/* ── EVM & TOKENS ───────────────────────────────────────── */}
              {activeSection === 'evm' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Coins className="w-5 h-5" /> EVM & Token Balances</h2>

                  <div className="text-xs text-muted-foreground border border-dashed border-border p-3">
                    EVM network is auto-resolved from wallet settings (<span className="font-mono text-foreground">connection.evmNetworkId</span>).
                    dApp does not need to specify it.
                  </div>

                  {/* getEvmTokens */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-green-600 dark:text-green-400">getEvmTokens() — auto-execute, read</h3>
                    <p className="text-[10px] text-muted-foreground">Fetches all ERC-20 token balances (common + custom) for the wallet's active EVM network.</p>
                    <button
                      onClick={handleGetEvmTokens}
                      disabled={!readCap || loading === 'evm-tokens'}
                      className="px-4 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'evm-tokens' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                      Get EVM Tokens
                    </button>
                    <ResultBox result={evmTokensResult} loading={loading === 'evm-tokens' && !evmTokensResult} />
                  </div>

                  {/* sendEvmTransaction info */}
                  <div className="space-y-2 border-t border-dashed border-border pt-4">
                    <h3 className="text-xs font-semibold text-orange-600 dark:text-orange-400">sendEvmTransaction() / sendErc20Transaction() — popup, write</h3>
                    <div className="text-[10px] text-muted-foreground space-y-1">
                      <p>Uses wallet's derived secp256k1 key to sign and broadcast ETH transactions.</p>
                      <p>Network defaults to wallet's active EVM network — no need to specify.</p>
                      <pre className="bg-muted/30 p-2 text-[10px] overflow-x-auto">{`// Send ETH
const result = await sdk.sendEvmTransaction(capId, {
  to: '0x...',
  amount: '0.01',   // ETH as string
  data: '0x...',    // optional calldata
});

// Send ERC-20
const result = await sdk.sendErc20Transaction(capId, {
  tokenContract: '0x4647e1fE715c9e23959022C2416C71867F5a6E80',
  to: '0x...',
  amount: '1000000',  // raw units
  decimals: 6,
  symbol: 'wOCT',
});`}</pre>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ── PRIVATE BALANCE ────────────────────────────────────── */}
              {activeSection === 'private' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Lock className="w-5 h-5" /> Private Balance & Stealth</h2>

                  <div className="text-xs text-muted-foreground border border-dashed border-border p-3">
                    Encrypted balance and stealth transfers require a PVAC server configured in wallet settings.
                    All HFHE proof generation happens inside the wallet — dApp only sends amounts/addresses.
                  </div>

                  {/* getEncryptedBalance */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-green-600 dark:text-green-400">getEncryptedBalance() — auto-execute, read</h3>
                    <button
                      onClick={handleGetEncryptedBalance}
                      disabled={!readCap || loading === 'enc-balance'}
                      className="px-4 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                    >
                      {loading === 'enc-balance' ? <Loader2 className="w-3 h-3 animate-spin" /> : <EyeOff className="w-3 h-3" />}
                      Get Encrypted Balance
                    </button>
                    <ResultBox result={encBalanceResult} loading={loading === 'enc-balance' && !encBalanceResult} />
                  </div>

                  {/* encrypt/decrypt/stealth code examples */}
                  <div className="space-y-2 border-t border-dashed border-border pt-4">
                    <h3 className="text-xs font-semibold text-orange-600 dark:text-orange-400">encryptBalance / decryptBalance / stealth — popup, write</h3>
                    <pre className="bg-muted/30 p-2 text-[10px] overflow-x-auto">{`// Move OCT → encrypted balance
const enc = await sdk.encryptBalance(capId, 1.0);
// enc.txHash, enc.amount

// Move encrypted balance → OCT
const dec = await sdk.decryptBalance(capId, 0.5);
// dec.txHash, dec.amount

// Send private transfer
const sent = await sdk.stealthSend(capId, { to: 'oct...', amount: 0.5 });

// Scan for claimable outputs (auto, no popup)
const outputs = await sdk.stealthScan(capId);
// outputs[].id, .amount, .sender, .epoch

// Claim a stealth output
const claimed = await sdk.stealthClaim(capId, outputs[0].id);`}</pre>
                  </div>
                </motion.div>
              )}

              {/* ── GAS ────────────────────────────────────────────────── */}
              {activeSection === 'gas' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Zap className="w-5 h-5" /> Gas Estimation</h2>
                  <button
                    onClick={handleEstimateGas}
                    disabled={!sdk || loading === 'gas'}
                    className="px-4 py-2 bg-[#3B567F] text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-xs"
                  >
                    {loading === 'gas' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    Fetch Live Fee Estimates
                  </button>
                  <ResultBox result={gasResult} loading={loading === 'gas' && !gasResult} />
                </motion.div>
              )}

              {/* ── ADVANCED ───────────────────────────────────────────── */}
              {activeSection === 'advanced' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <h2 className="text-lg font-bold flex items-center gap-2"><RefreshCw className="w-5 h-5" /> Advanced Features</h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={handleListCapabilities} disabled={!sdk || !!loading} className="px-3 py-2 border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1">
                      {loading === 'list-caps' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />} List Capabilities
                    </button>
                    <button onClick={handleRenewCapability} disabled={!sdk || capabilities.length === 0 || !!loading} className="px-3 py-2 border border-border text-xs hover:bg-muted transition-colors disabled:opacity-50 flex items-center gap-1">
                      {loading === 'renew-cap' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Renew First Cap
                    </button>
                    <button onClick={handleRevokeCapability} disabled={!sdk || capabilities.length === 0 || !!loading} className="px-3 py-2 border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50 flex items-center gap-1">
                      {loading === 'revoke-cap' ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} Revoke Last Cap
                    </button>
                  </div>
                  <ResultBox result={advancedResult} loading={(loading === 'list-caps') && !advancedResult} />

                  <div className="border-t border-dashed border-border pt-4 space-y-2">
                    <h3 className="text-xs font-semibold">getSessionState()</h3>
                    <pre className="bg-muted/30 p-2 text-[10px] overflow-x-auto">{
                      sdk ? JSON.stringify(sdk.getSessionState(), null, 2) : 'SDK not initialized'
                    }</pre>
                  </div>
                </motion.div>
              )}

              {/* ── DEMOS ──────────────────────────────────────────────── */}
              {activeSection === 'demo' && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                  <h2 className="text-lg font-bold flex items-center gap-2"><Zap className="w-5 h-5" /> Feature Demos</h2>

                  {/* Error handling demos */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Error Handling Patterns</h3>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={handleDemoRetry} disabled={!!loading} className="px-3 py-2 border border-border text-xs hover:bg-muted disabled:opacity-50 flex items-center gap-1">
                        {loading === 'demo-retry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Retry ({retryCount > 0 ? `attempt ${retryCount}` : 'exponential backoff'})
                      </button>
                      <button onClick={handleDemoCircuitBreaker} disabled={!!loading} className="px-3 py-2 border border-border text-xs hover:bg-muted disabled:opacity-50 flex items-center gap-1">
                        {loading === 'demo-circuit' ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                        Circuit Breaker
                      </button>
                      <button onClick={handleDemoTimeout} disabled={!!loading} className="px-3 py-2 border border-border text-xs hover:bg-muted disabled:opacity-50 flex items-center gap-1">
                        {loading === 'demo-timeout' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                        Timeout Pattern
                      </button>
                    </div>
                  </div>

                  {/* HFHE circuits */}
                  <div className="space-y-2 border-t border-dashed border-border pt-4">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">HFHE Circuit Simulation</h3>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(HFHE_CIRCUITS) as Array<keyof typeof HFHE_CIRCUITS>).map(key => (
                        <button
                          key={key}
                          onClick={() => handleDemoHFHECircuit(key)}
                          disabled={!!loading}
                          className="px-3 py-2 border border-border text-xs hover:bg-muted disabled:opacity-50 flex items-center gap-1"
                        >
                          {loading === `demo-hfhe-${key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
                          {HFHE_CIRCUITS[key].name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ResultBox result={demoResult} />
                </motion.div>
              )}

            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
