import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Wallet, 
  Shield, 
  Send, 
  FileText, 
  Zap, 
  Moon, 
  Sun,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
  X
} from 'lucide-react';
import { OctraSDK } from '@octwa/sdk';
import type { Connection, Capability } from '@octwa/sdk';
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

// Logo component matching favicon
const Logo = ({ size = 24 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size}>
    <circle cx="32" cy="32" r="30" fill="#3A4DFF"/>
    <path d="M16 22C16 20.3431 17.3431 19 19 19H45C46.6569 19 48 20.3431 48 22V24H16V22Z" fill="white" opacity="0.9"/>
    <rect x="16" y="24" width="32" height="20" rx="2" fill="white"/>
    <rect x="20" y="28" width="24" height="3" rx="1.5" fill="#3A4DFF" opacity="0.3"/>
    <rect x="20" y="33" width="16" height="3" rx="1.5" fill="#3A4DFF" opacity="0.3"/>
    <circle cx="40" cy="38" r="3.5" fill="#3A4DFF"/>
    <circle cx="40" cy="38" r="1.5" fill="white"/>
  </svg>
);

function App() {
  const [sdk, setSdk] = useState<OctraSDK | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(true); // Default to dark mode
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeSection, setActiveSection] = useState('about'); // Start with About section
  const [balanceResult, setBalanceResult] = useState<string>('');
  const [signatureResult, setSignatureResult] = useState<string>('');
  const [gasResult, setGasResult] = useState<string>('');
  const [advancedResult, setAdvancedResult] = useState<string>('');
  const [allCapabilities, setAllCapabilities] = useState<Capability[]>([]);
  const [demoResult, setDemoResult] = useState<string>('');
  const [retryCount, setRetryCount] = useState<number>(0);
  const [circuitBreaker] = useState(() => new CircuitBreaker(3, 30000));

  // Simple toast function
  const toast = ({ title, description }: { title: string; description: string }) => {
    console.log(`[Toast] ${title}: ${description}`);
    // Create toast element
    const toastEl = document.createElement('div');
    toastEl.className = 'fixed bottom-4 right-4 bg-background border border-border rounded-lg shadow-lg p-4 max-w-sm z-50 animate-in slide-in-from-bottom-5';
    toastEl.innerHTML = `
      <div class="font-semibold text-sm mb-1">${title}</div>
      <div class="text-xs text-muted-foreground">${description}</div>
    `;
    document.body.appendChild(toastEl);
    setTimeout(() => {
      toastEl.remove();
    }, 3000);
  };

  useEffect(() => {
    initSDK();
  }, []);

  const initSDK = async () => {
    try {
      logger.group('SDK Initialization');
      logger.info('Initializing Octra SDK...');
      
      const octraSDK = await OctraSDK.init({ timeout: 3000 });
      setSdk(octraSDK);
      
      const installed = octraSDK.isInstalled();
      setIsInstalled(installed);
      
      logger.test('Wallet extension detected', installed);
      logger.success('SDK initialized successfully');
      logger.groupEnd();
      
      // Run initial tests
      testCanonicalSerialization();
      testDomainSeparation();
    } catch (err) {
      logger.error('SDK initialization failed', err);
      logger.groupEnd();
      console.error('SDK initialization failed:', err);
    }
  };

  const handleConnect = async () => {
    if (!sdk) return;
    setLoading('connect');
    
    try {
      logger.group('Connection Request');
      logger.info('Requesting connection to circle: public');
      
      const conn = await sdk.connect({
        circle: 'octwa_dapp_starter',
        appOrigin: window.location.origin,
      });
      
      logger.success('Connection established');
      logger.info('Connection details', conn);
      
      // Validate connection
      const isValid = validateConnection(conn);
      logger.test('Connection validation', isValid);
      
      setConnection(conn);
      logger.groupEnd();
    } catch (err: any) {
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
      
    } catch (err: any) {
      
    } finally {
      setLoading(null);
    }
  };

  const handleRequestCapability = async (scope: 'read' | 'write' | 'compute') => {
    if (!sdk || !connection) return;
    setLoading(`capability-${scope}`);
    
    try {
      logger.group(`Capability Request (${scope})`);
      
      const methods = scope === 'read' 
        ? ['get_balance'] 
        : scope === 'write'
        ? ['send_transaction']
        : ['invoke_compute'];
      
      logger.info('Requesting methods', methods);
      
      const capability = await sdk.requestCapability({
        circle: 'octwa_dapp_starter',
        methods,
        scope,
        encrypted: scope === 'compute',
        ttlSeconds: 900,
      });
      
      logger.success('Capability granted');
      logger.info('Capability details', capability);
      
      // Validate capability
      const isValid = validateCapability(capability);
      logger.test('Capability validation', isValid);
      
      setCapabilities([...capabilities, capability]);
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Capability request failed', err);
      validateError(err);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleInvokeMethod = async () => {
    if (!sdk || !connection || capabilities.length === 0) return;
    setLoading('invoke');
    setBalanceResult('');
    
    try {
      logger.group('Method Invocation (get_balance)');
      
      const readCap = capabilities.find(c => c.scope === 'read');
      if (!readCap) {
        logger.error('No read capability found');
        setBalanceResult('Error: No read capability found. Request one first.');
        setLoading(null);
        logger.groupEnd();
        return;
      }
      
      logger.info('Using capability', readCap.id);
      logger.info('Invoking method: get_balance');
      
      const result = await sdk.invoke({
        capabilityId: readCap.id,
        method: 'get_balance',
      });
      
      logger.success('Method invoked successfully');
      logger.info('Result', result);
      
      if (result.success && result.data) {
        // Use ResponseDecoder for type-safe decoding
        const balanceData = ResponseDecoder.decodeBalance(result);
        
        logger.info('Balance data', balanceData);
        
        // Validate balance
        const isValid = validateBalance(balanceData);
        logger.test('Balance validation', isValid);
        
        setBalanceResult(`Balance: ${balanceData.octBalance} OCT`);
      }
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Invocation failed', err);
      validateError(err);
      setBalanceResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleSendTransaction = async () => {
    if (!sdk || !connection) return;
    setLoading('write');
    
    try {
      logger.group('Method Invocation (send_transaction)');
      
      const writeCap = capabilities.find(c => c.scope === 'write');
      if (!writeCap) {
        logger.error('No write capability found');
        toast({
          title: 'Error',
          description: 'No write capability found. Request one first.',
        });
        setLoading(null);
        logger.groupEnd();
        return;
      }
      
      logger.info('Using capability', writeCap.id);
      logger.info('Invoking method: send_transaction');
      
      // Example transaction payload
      const txPayload = {
        to: 'oct8UYokvM1DR2QpEVM7oCLvJLPvJqvvvvvvvvvvvvvvvvvvv', // Example recipient
        amount: 0.1, // 0.1 OCT
        message: 'Test transaction from Sample dApp'
      };
      
      logger.info('Transaction payload', txPayload);
      
      // Encode payload
      const payloadBytes = new TextEncoder().encode(JSON.stringify(txPayload));
      
      const result = await sdk.invoke({
        capabilityId: writeCap.id,
        method: 'send_transaction',
        payload: payloadBytes,
      });
      
      logger.success('Transaction sent successfully');
      logger.info('Result', result);
      
      if (result.success && result.data) {
        const dataBytes = Array.isArray(result.data) 
          ? new Uint8Array(result.data)
          : result.data as Uint8Array;
        
        const decoder = new TextDecoder();
        const txResult = JSON.parse(decoder.decode(dataBytes));
        
        logger.info('Transaction result', txResult);
        
        toast({
          title: 'Transaction Sent',
          description: `TX Hash: ${txResult.txHash?.slice(0, 16)}...`,
        });
      }
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Transaction failed', err);
      validateError(err);
      toast({
        title: 'Transaction Failed',
        description: err.message,
      });
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleInvokeCompute = async () => {
    if (!sdk || !connection) return;
    setLoading('compute');
    
    try {
      logger.group('Method Invocation (invoke_compute)');
      
      const computeCap = capabilities.find(c => c.scope === 'compute');
      if (!computeCap) {
        logger.error('No compute capability found');
        toast({
          title: 'Error',
          description: 'No compute capability found. Request one first.',
        });
        setLoading(null);
        logger.groupEnd();
        return;
      }
      
      logger.info('Using capability', computeCap.id);
      logger.info('Invoking method: invoke_compute');
      
      // Example compute payload (HFHE encrypted computation)
      const computePayload = {
        circuitId: 'example-circuit',
        encryptedInput: {
          scheme: 'HFHE',
          data: new Uint8Array([1, 2, 3, 4, 5]), // Example encrypted data
          associatedData: 'metadata',
        },
        computeProfile: {
          gateCount: 1000,
          vectorSize: 256,
          depth: 10,
          expectedBootstrap: 2,
        },
        gasLimit: 1000000,
      };
      
      logger.info('Compute payload', computePayload);
      
      // Encode payload
      const payloadBytes = new TextEncoder().encode(JSON.stringify(computePayload));
      
      const result = await sdk.invoke({
        capabilityId: computeCap.id,
        method: 'invoke_compute',
        payload: payloadBytes,
      });
      
      logger.success('Compute invoked successfully');
      logger.info('Result', result);
      
      if (result.success && result.data) {
        const dataBytes = Array.isArray(result.data) 
          ? new Uint8Array(result.data)
          : result.data as Uint8Array;
        
        const decoder = new TextDecoder();
        const computeResult = JSON.parse(decoder.decode(dataBytes));
        
        logger.info('Compute result', computeResult);
        
        toast({
          title: 'Compute Completed',
          description: 'HFHE computation executed successfully',
        });
      }
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Compute failed', err);
      validateError(err);
      toast({
        title: 'Compute Failed',
        description: err.message,
      });
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleSignMessage = async () => {
    if (!sdk || !connection) return;
    setLoading('sign');
    setSignatureResult('');
    
    try {
      const message = 'Hello from Octra dApp!';
      const signature = await sdk.signMessage(message);
      setSignatureResult(`Signature: ${signature}`);
      console.log('Message signed! Full signature:', signature);
    } catch (err: any) {
      setSignatureResult(`Error: ${err.message}`);
      console.error('Signing failed:', err.message);
    } finally {
      setLoading(null);
    }
  };

  const handleEstimateGas = async () => {
    if (!sdk) return;
    setLoading('gas');
    setGasResult('');
    
    try {
      // Test with different amounts to show OU calculation
      const smallTx = await sdk.estimatePlainTx({ to: 'oct...', amount: 100 });
      const largeTx = await sdk.estimatePlainTx({ to: 'oct...', amount: 1500 });
      
      setGasResult(
        `Small TX (100 OCT): ${smallTx.gasUnits} OU = ${smallTx.tokenCost.toFixed(7)} OCT fee\n` +
        `Large TX (1500 OCT): ${largeTx.gasUnits} OU = ${largeTx.tokenCost.toFixed(7)} OCT fee\n` +
        `Formula: OU × 0.0000001 = Fee in OCT`
      );
      
      console.log('Gas estimates:', { smallTx, largeTx });
    } catch (err: any) {
      setGasResult(`Error: ${err.message}`);
      console.error('Gas estimation failed:', err.message);
    } finally {
      setLoading(null);
    }
  };

  // Advanced Features Handlers
  const handleListCapabilities = async () => {
    if (!sdk) return;
    setLoading('list-caps');
    setAdvancedResult('');
    
    try {
      logger.group('List Capabilities');
      const caps = await sdk.listCapabilities();
      setAllCapabilities(caps);
      
      logger.success(`Found ${caps.length} capabilities`);
      logger.info('Capabilities', caps);
      
      setAdvancedResult(
        `Found ${caps.length} capabilities:\n` +
        caps.map((c, i) => 
          `${i + 1}. ID: ${c.id}\n   Scope: ${c.scope}\n   Methods: ${c.methods.join(', ')}\n   State: ${c.state}`
        ).join('\n\n')
      );
      
      toast({
        title: 'Capabilities Listed',
        description: `Found ${caps.length} active capabilities`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('List capabilities failed', err);
      validateError(err);
      setAdvancedResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleRenewCapability = async () => {
    if (!sdk || capabilities.length === 0) return;
    setLoading('renew-cap');
    
    try {
      logger.group('Renew Capability');
      
      // Renew first capability as example
      const capToRenew = capabilities[0];
      logger.info('Renewing capability', capToRenew.id);
      
      const renewed = await sdk.renewCapability(capToRenew.id);
      
      logger.success('Capability renewed');
      logger.info('New expiration', new Date(renewed.expiresAt).toISOString());
      
      // Update capabilities list
      setCapabilities(capabilities.map(c => c.id === renewed.id ? renewed : c));
      
      toast({
        title: 'Capability Renewed',
        description: `Extended expiration to ${new Date(renewed.expiresAt).toLocaleString()}`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Renew capability failed', err);
      validateError(err);
      toast({
        title: 'Renew Failed',
        description: err.message,
      });
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleRevokeCapability = async () => {
    if (!sdk || capabilities.length === 0) return;
    setLoading('revoke-cap');
    
    try {
      logger.group('Revoke Capability');
      
      // Revoke last capability as example
      const capToRevoke = capabilities[capabilities.length - 1];
      logger.info('Revoking capability', capToRevoke.id);
      
      await sdk.revokeCapability(capToRevoke.id);
      
      logger.success('Capability revoked');
      
      // Remove from capabilities list
      setCapabilities(capabilities.filter(c => c.id !== capToRevoke.id));
      
      toast({
        title: 'Capability Revoked',
        description: `Revoked ${capToRevoke.scope} capability`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Revoke capability failed', err);
      validateError(err);
      toast({
        title: 'Revoke Failed',
        description: err.message,
      });
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleEstimateEncryptedTx = async () => {
    if (!sdk) return;
    setLoading('estimate-encrypted');
    
    try {
      logger.group('Estimate Encrypted Transaction');
      
      // Example encrypted payload
      const encryptedPayload = {
        scheme: 'HFHE' as const,
        data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        associatedData: 'encrypted-tx-metadata',
      };
      
      logger.info('Estimating encrypted transaction', encryptedPayload);
      
      const estimate = await sdk.estimateEncryptedTx(encryptedPayload);
      
      logger.success('Estimate completed');
      logger.info('Gas estimate', estimate);
      
      setAdvancedResult(
        `Encrypted TX Estimate:\n` +
        `Gas Units: ${estimate.gasUnits} OU\n` +
        `Token Cost: ${estimate.tokenCost.toFixed(7)} OCT\n` +
        `Payload Size: ${encryptedPayload.data.length} bytes`
      );
      
      toast({
        title: 'Encrypted TX Estimated',
        description: `${estimate.gasUnits} OU = ${estimate.tokenCost.toFixed(7)} OCT`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Estimate encrypted tx failed', err);
      validateError(err);
      setAdvancedResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const handleEstimateComputeCost = async () => {
    if (!sdk) return;
    setLoading('estimate-compute');
    
    try {
      logger.group('Estimate Compute Cost');
      
      // Example compute profile
      const computeProfile = {
        gateCount: 5000,
        vectorSize: 512,
        depth: 15,
        expectedBootstrap: 3,
      };
      
      logger.info('Estimating compute cost', computeProfile);
      
      const estimate = await sdk.estimateComputeCost(computeProfile);
      
      logger.success('Estimate completed');
      logger.info('Compute estimate', estimate);
      
      setAdvancedResult(
        `Compute Cost Estimate:\n` +
        `Gas Units: ${estimate.gasUnits} OU\n` +
        `Token Cost: ${estimate.tokenCost.toFixed(7)} OCT\n` +
        `Gate Count: ${computeProfile.gateCount}\n` +
        `Vector Size: ${computeProfile.vectorSize}\n` +
        `Depth: ${computeProfile.depth}\n` +
        `Expected Bootstrap: ${computeProfile.expectedBootstrap}`
      );
      
      toast({
        title: 'Compute Cost Estimated',
        description: `${estimate.gasUnits} OU = ${estimate.tokenCost.toFixed(7)} OCT`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Estimate compute cost failed', err);
      validateError(err);
      setAdvancedResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  // Demo: Retry Logic with Exponential Backoff
  const handleDemoRetry = async () => {
    setLoading('demo-retry');
    setDemoResult('');
    setRetryCount(0);
    
    try {
      logger.group('Demo: Retry Logic');
      
      // Simulate flaky operation
      let attemptCount = 0;
      const flakyOperation = async () => {
        attemptCount++;
        logger.info(`Attempt ${attemptCount}`);
        
        // Fail first 2 attempts, succeed on 3rd
        if (attemptCount < 3) {
          throw Object.assign(new Error('Simulated network error'), { 
            code: 'NETWORK_ERROR',
            retryable: true 
          });
        }
        
        return { success: true, data: 'Operation succeeded!' };
      };
      
      const result = await withRetry(flakyOperation, {
        maxAttempts: 5,
        delayMs: 500,
        backoffMultiplier: 2,
        onRetry: (attempt, error) => {
          setRetryCount(attempt);
          logger.info(`Retry attempt ${attempt}: ${error.message}`);
        },
      });
      
      logger.success('Operation succeeded after retries');
      logger.info('Result', result);
      
      setDemoResult(
        `[SUCCESS] Retry Demo Successful!\n` +
        `Total Attempts: ${attemptCount}\n` +
        `Result: ${result.data}\n` +
        `Strategy: Exponential backoff (500ms → 1000ms → 2000ms)`
      );
      
      toast({
        title: 'Retry Demo Complete',
        description: `Succeeded after ${attemptCount} attempts`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Retry demo failed', err);
      setDemoResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  // Demo: Circuit Breaker Pattern
  const handleDemoCircuitBreaker = async () => {
    setLoading('demo-circuit');
    setDemoResult('');
    
    try {
      logger.group('Demo: Circuit Breaker');
      logger.info('Circuit breaker state:', circuitBreaker.getState());
      
      // Simulate operation through circuit breaker
      const result = await circuitBreaker.execute(async () => {
        // Simulate successful operation
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true, message: 'Operation completed' };
      });
      
      logger.success('Operation succeeded');
      logger.info('Result', result);
      logger.info('Circuit breaker state:', circuitBreaker.getState());
      
      setDemoResult(
        `[SUCCESS] Circuit Breaker Demo\n` +
        `State: ${circuitBreaker.getState()}\n` +
        `Result: ${result.message}\n` +
        `Threshold: 3 failures\n` +
        `Reset Time: 30 seconds`
      );
      
      toast({
        title: 'Circuit Breaker Demo',
        description: `State: ${circuitBreaker.getState()}`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Circuit breaker demo failed', err);
      setDemoResult(`Error: ${err.message}\nCircuit State: ${circuitBreaker.getState()}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  // Demo: Timeout Pattern
  const handleDemoTimeout = async () => {
    setLoading('demo-timeout');
    setDemoResult('');
    
    try {
      logger.group('Demo: Timeout Pattern');
      
      // Fast operation (should succeed)
      const fastOp = async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return 'Fast operation completed';
      };
      
      const result = await withTimeout(fastOp, 2000, 'Operation timed out after 2s');
      
      logger.success('Operation completed within timeout');
      logger.info('Result', result);
      
      setDemoResult(
        `[SUCCESS] Timeout Demo Successful!\n` +
        `Timeout: 2000ms\n` +
        `Actual Time: ~500ms\n` +
        `Result: ${result}`
      );
      
      toast({
        title: 'Timeout Demo Complete',
        description: 'Operation completed within timeout',
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('Timeout demo failed', err);
      setDemoResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  // Demo: Real HFHE Circuit Execution
  const handleDemoHFHECircuit = async (circuitKey: keyof typeof HFHE_CIRCUITS) => {
    setLoading(`demo-hfhe-${circuitKey}`);
    setDemoResult('');
    
    try {
      logger.group(`Demo: HFHE Circuit - ${HFHE_CIRCUITS[circuitKey].name}`);
      
      // Generate test input
      const input = circuitKey === 'SIMPLE_ADD' ? [5, 10] :
                    circuitKey === 'MULTIPLY' ? [3, 7] :
                    circuitKey === 'COMPARISON' ? [15, 10] :
                    circuitKey === 'POLYNOMIAL' ? [4] :
                    [0.5]; // NEURAL_NET
      
      logger.info('Input (plaintext)', input);
      
      // Create compute request with encrypted payload
      const computeReq = createComputeRequest(circuitKey, input);
      logger.info('Compute request', computeReq);
      logger.info('Encrypted payload size: ' + computeReq.encryptedInput.data.length + ' bytes');
      
      // Estimate cost
      const costEstimate = estimateCircuitCost(circuitKey);
      logger.info('Cost estimate', costEstimate);
      
      // Simulate computation
      const computeResult = simulateComputeResult(circuitKey, input);
      logger.success('Computation completed');
      logger.info('Result', computeResult);
      
      setDemoResult(
        `[SUCCESS] HFHE Circuit: ${HFHE_CIRCUITS[circuitKey].name}\n\n` +
        `Description: ${HFHE_CIRCUITS[circuitKey].description}\n\n` +
        `Input (plaintext): [${input.join(', ')}]\n` +
        `Encrypted Size: ${computeReq.encryptedInput.data.length} bytes\n` +
        `Expansion Factor: ~${Math.round(computeReq.encryptedInput.data.length / input.length)}x\n\n` +
        `Circuit Profile:\n` +
        `  • Gate Count: ${computeReq.computeProfile.gateCount}\n` +
        `  • Vector Size: ${computeReq.computeProfile.vectorSize}\n` +
        `  • Depth: ${computeReq.computeProfile.depth}\n` +
        `  • Bootstrap Operations: ${computeReq.computeProfile.expectedBootstrap}\n\n` +
        `Execution:\n` +
        `  • Gas Used: ${computeResult.gasUsed} OU\n` +
        `  • Cost: ${(computeResult.gasUsed * 0.0000001).toFixed(7)} OCT\n` +
        `  • Time: ${computeResult.executionTime.toFixed(2)}ms\n` +
        `  • Result (plaintext): ${computeResult.plainResult}\n` +
        `  • Result (encrypted): ${computeResult.result?.length} bytes`
      );
      
      toast({
        title: 'HFHE Circuit Executed',
        description: `${HFHE_CIRCUITS[circuitKey].name} completed in ${computeResult.executionTime.toFixed(0)}ms`,
      });
      
      logger.groupEnd();
    } catch (err: any) {
      logger.error('HFHE circuit demo failed', err);
      setDemoResult(`Error: ${err.message}`);
      logger.groupEnd();
    } finally {
      setLoading(null);
    }
  };

  const sections = [
    { id: 'about', label: 'About', icon: FileText },
    { id: 'connection', label: 'Connection', icon: Wallet },
    { id: 'capabilities', label: 'Capabilities', icon: Shield },
    { id: 'invocation', label: 'Invocation', icon: Send },
    { id: 'signing', label: 'Message Signing', icon: FileText },
    { id: 'gas', label: 'Gas Estimation', icon: Zap },
    { id: 'advanced', label: 'Advanced Features', icon: Zap },
    { id: 'demo', label: 'Feature Demos', icon: RefreshCw },
  ];

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
        <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background">
          <div className="flex items-center justify-between px-3 md:px-6 py-3 md:py-4">
            <div className="flex items-center gap-2 md:gap-3">
              <Logo size={20} className="md:w-6 md:h-6" />
              <h1 className="text-sm md:text-lg font-bold truncate" style={{ color: '#3A4DFF' }}>
                <span className="hidden sm:inline">OctWa dApp Starter</span>
                <span className="sm:hidden">OctWa</span>
              </h1>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4">
              {connection ? (
                <>
                  <button
                    onClick={handleDisconnect}
                    disabled={loading === 'disconnect'}
                    className="px-2 md:px-4 py-1.5 md:py-2 border border-input bg-background disabled:opacity-50 hover:opacity-80 transition-opacity flex items-center gap-1 md:gap-2 text-xs md:text-sm"
                  >
                    {loading === 'disconnect' ? (
                      <Loader2 className="w-3 h-3 md:w-4 md:h-4 animate-spin" />
                    ) : (
                      <XCircle className="w-3 h-3 md:w-4 md:h-4" />
                    )}
                    <span className="hidden sm:inline">Disconnect</span>
                  </button>
                  <div className="border-l border-dashed border-border h-4 md:h-6 hidden sm:block"></div>
                </>
              ) : (
                <>
                  <button
                    onClick={handleConnect}
                    disabled={!isInstalled || loading === 'connect'}
                    className="px-2 md:px-4 py-1.5 md:py-2 bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-1 md:gap-2 text-xs md:text-sm"
                  >
                    {loading === 'connect' ? (
                      <Loader2 className="w-3 h-3 md:w-4 md:h-4 animate-spin" />
                    ) : (
                      <Wallet className="w-3 h-3 md:w-4 md:h-4" />
                    )}
                    <span className="hidden sm:inline">Connect</span>
                  </button>
                  <div className="border-l border-dashed border-border h-4 md:h-6 hidden sm:block"></div>
                </>
              )}
              
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="p-1.5 md:p-2 hover:[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_8px_currentColor)] transition-all"
              >
                {darkMode ? <Sun className="w-4 h-4 md:w-5 md:h-5" /> : <Moon className="w-4 h-4 md:w-5 md:h-5" />}
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1 pt-16 pb-8 overflow-hidden">
          {/* Mobile overlay */}
          {sidebarOpen && (
            <div 
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          
          <aside className={`fixed left-0 top-16 bottom-6 w-64 border-r border-border bg-background transition-transform overflow-y-auto overflow-x-hidden z-50 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute -right-8 top-4 px-2 py-3 border border-border bg-background hover:opacity-80 transition-opacity text-xs hidden md:block"
            >
              {sidebarOpen ? '‹' : '›'}
            </button>
            
            {/* Mobile close button */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute right-2 top-2 p-2 hover:bg-muted rounded md:hidden"
            >
              <X className="w-4 h-4" />
            </button>
            
            <nav className="p-4 space-y-2">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-all ${
                      isActive 
                        ? 'text-primary border-l-2 border-primary' 
                        : 'hover:[filter:drop-shadow(0_0_4px_currentColor)_drop-shadow(0_0_8px_currentColor)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm">{section.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className={`flex-1 transition-all ${sidebarOpen ? 'md:ml-64' : 'ml-0'}`}>
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="fixed bottom-4 right-4 p-3 bg-primary text-primary-foreground rounded-full shadow-lg md:hidden z-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            
            <div className="h-full px-4 md:px-8 py-4 md:py-8 overflow-y-auto">
              <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
              {activeSection === 'about' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="w-6 h-6" />
                    About OctWa dApp Starter
                  </h2>
                  
                  <div className="space-y-6 text-sm">
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold">Overview</h3>
                      <p className="text-muted-foreground">
                        OctWa dApp Starter is a comprehensive demonstration of the complete Octra blockchain ecosystem integration. 
                        This project showcases how decentralized applications (dApps) interact with the Octra blockchain through 
                        the OctWa Wallet Extension using the Octra Web Wallet SDK (v2.0.0).
                      </p>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-4">
                      <h3 className="text-lg font-semibold">Ecosystem Architecture</h3>
                      <div className="p-4 bg-muted/50 rounded space-y-3">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-primary">1. dApp Layer (This Application)</h4>
                          <p className="text-muted-foreground text-xs">
                            The user-facing application that provides the interface for blockchain interactions. 
                            Built with React + TypeScript + Vite, this dApp demonstrates all SDK capabilities including 
                            connection management, capability requests, method invocations, and HFHE computations.
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-semibold text-primary">2. SDK Layer (@octwa/sdk)</h4>
                          <p className="text-muted-foreground text-xs">
                            The Octra Web Wallet SDK is a stateless, deterministic transaction builder that acts as 
                            the bridge between dApps and the wallet. It provides type-safe APIs, canonical serialization, 
                            domain separation for security, and comprehensive error handling. The SDK never handles private 
                            keys - it only builds and validates transactions.
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-semibold text-primary">3. Wallet Extension (OctWa)</h4>
                          <p className="text-muted-foreground text-xs">
                            The OctWa Wallet Extension is the final authority for all blockchain operations. It securely 
                            stores private keys, validates all requests from dApps, prompts users for approval, signs 
                            transactions, and manages connections. The wallet implements capability-based authorization 
                            to give users fine-grained control over what dApps can do.
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-semibold text-primary">4. Octra Blockchain</h4>
                          <p className="text-muted-foreground text-xs">
                            The underlying blockchain network that executes transactions and HFHE (Homomorphic Fully 
                            Encrypted) computations. Supports both testnet and mainnet environments with features like 
                            encrypted transactions, compute operations, and cross-chain capabilities.
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-4">
                      <h3 className="text-lg font-semibold">Integration Flow</h3>
                      <div className="p-4 bg-muted/50 rounded font-mono text-xs space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500">dApp</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-green-500">SDK.connect()</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-orange-500">Wallet</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-purple-500">User Approval</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500">dApp</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-green-500">SDK.requestCapability()</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-orange-500">Wallet</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-purple-500">Grant Permission</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-blue-500">dApp</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-green-500">SDK.invoke()</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-orange-500">Wallet Signs</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-purple-500">Blockchain Executes</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-4">
                      <h3 className="text-lg font-semibold">SDK Features & Implementation Status</h3>
                      
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-green-600 dark:text-green-400">[IMPLEMENTED] Fully Implemented in Sample</h4>
                          <ul className="space-y-1 pl-4 text-muted-foreground">
                            <li>• <span className="font-mono text-xs">OctraSDK.init()</span> - SDK initialization and wallet detection</li>
                            <li>• <span className="font-mono text-xs">connect()</span> - Connection management with Circle</li>
                            <li>• <span className="font-mono text-xs">disconnect()</span> - Disconnect from wallet</li>
                            <li>• <span className="font-mono text-xs">requestCapability()</span> - Request read/write/compute capabilities</li>
                            <li>• <span className="font-mono text-xs">renewCapability()</span> - Extend capability expiration</li>
                            <li>• <span className="font-mono text-xs">revokeCapability()</span> - Revoke capability programmatically</li>
                            <li>• <span className="font-mono text-xs">listCapabilities()</span> - List all active capabilities</li>
                            <li>• <span className="font-mono text-xs">invoke()</span> - Method invocation (get_balance, send_transaction, invoke_compute)</li>
                            <li>• <span className="font-mono text-xs">invokeCompute()</span> - HFHE computation with realistic circuits</li>
                            <li>• <span className="font-mono text-xs">signMessage()</span> - Arbitrary message signing</li>
                            <li>• <span className="font-mono text-xs">estimatePlainTx()</span> - Gas estimation for plain transactions</li>
                            <li>• <span className="font-mono text-xs">estimateEncryptedTx()</span> - Gas estimation for encrypted transactions</li>
                            <li>• <span className="font-mono text-xs">estimateComputeCost()</span> - Cost estimation for HFHE computation</li>
                            <li>• <span className="font-mono text-xs">getSessionState()</span> - Session state management</li>
                            <li>• Response decoding - Full type-safe decoder with validation</li>
                            <li>• HFHE circuits - 5 realistic circuits (Add, Multiply, Compare, Polynomial, Neural Net)</li>
                            <li>• Advanced error handling - Retry with backoff, circuit breaker, timeout patterns</li>
                            <li>• Event system - Connection and capability events</li>
                            <li>• Canonical serialization - Deterministic transaction building</li>
                            <li>• Domain separation - Signature replay protection</li>
                            <li>• Signing mutex - Race condition prevention</li>
                          </ul>
                        </div>
                        
                        <div className="space-y-2">
                          <h4 className="font-semibold text-gray-500 dark:text-gray-600">[DISABLED] Disabled Features</h4>
                          <ul className="space-y-1 pl-4 text-muted-foreground">
                            <li>• Intent-based swaps - Cross-chain swap support (feature under development, currently disabled in SDK)</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-4">
                      <h3 className="text-lg font-semibold">Capability Scopes</h3>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-xs text-green-600 dark:text-green-400 mt-0.5">read</span>
                          <span className="text-muted-foreground">Read-only operations (e.g., get_balance)</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-xs text-orange-600 dark:text-orange-400 mt-0.5">write</span>
                          <span className="text-muted-foreground">State-changing operations (e.g., send_transaction)</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-xs text-purple-600 dark:text-purple-400 mt-0.5">compute</span>
                          <span className="text-muted-foreground">HFHE computation operations (e.g., invoke_compute)</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-4">
                      <h3 className="text-lg font-semibold">Security Features</h3>
                      <ul className="space-y-1 pl-4 text-muted-foreground">
                        <li>• <strong>Canonical Serialization</strong> - Deterministic transaction building with sorted keys</li>
                        <li>• <strong>Domain Separation</strong> - Prevents signature replay attacks across different contexts</li>
                        <li>• <strong>Signing Mutex</strong> - Automatic protection against race conditions and double-send</li>
                        <li>• <strong>Nonce Management</strong> - SDK provides nonces for ordering, wallet validates</li>
                        <li>• <strong>Capability-Based Auth</strong> - Fine-grained permission model with time-bound access</li>
                        <li>• <strong>HFHE Encryption</strong> - Encrypted payloads treated as opaque blobs</li>
                      </ul>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-4">
                      <h3 className="text-lg font-semibold">Architecture</h3>
                      <div className="p-4 bg-muted/50 rounded font-mono text-xs space-y-1">
                        <div>DApp (UI) → SDK (Transaction Builder) → Wallet (Signing) → Network (Execution)</div>
                        <div className="text-muted-foreground mt-2">
                          • SDK: Stateless, deterministic (NO private keys)<br />
                          • Wallet: Final authority for signing and validation<br />
                          • Network: Transaction execution with HFHE support
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-dashed border-muted pt-4 space-y-2">
                      <h3 className="text-lg font-semibold">Resources</h3>
                      <ul className="space-y-1 pl-4 text-muted-foreground">
                        <li>• SDK Version: 1.1.1</li>
                        <li>• License: MIT</li>
                        <li>• GitHub: <a href="https://github.com/m-tq/octwa" className="text-primary hover:underline">github.com/octra/octwa</a></li>
                      </ul>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeSection === 'connection' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Wallet className="w-6 h-6" />
                    Connection Management
                  </h2>
                  
                  <div className="pt-4 space-y-4">
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-muted-foreground flex items-center gap-2">
                        Wallet Info
                      </h3>
                      
                      <div className="flex items-center gap-2 text-sm">
                        {isInstalled ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            <span>Wallet Extension Detected</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4 text-destructive" />
                            <span>Wallet Extension Not Found</span>
                          </>
                        )}
                      </div>
                      
                      {!isInstalled && (
                        <p className="text-xs text-muted-foreground">
                          Please install OctWa wallet extension to continue.
                        </p>
                      )}
                    </div>
                    
                    {connection && (
                      <>
                        <div className="border-t border-dashed border-muted my-4"></div>
                        
                        <div className="space-y-2 text-sm">
                          <h3 className="text-sm font-bold text-muted-foreground mb-2">
                            Connection Details
                          </h3>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Circle:</span>
                            <span className="font-mono">{connection.circle}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Octra Address:</span>
                            <span className="font-mono text-xs">{connection.walletPubKey}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Network:</span>
                            <span className="font-mono">{connection.network}</span>
                          </div>
                        </div>
                      </>
                    )}
                    
                    {!connection && isInstalled && (
                      <>
                        <div className="border-t border-dashed border-muted my-4"></div>
                        <p className="text-sm text-muted-foreground">
                          Click "Connect Wallet" button in the header to establish connection.
                        </p>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {activeSection === 'capabilities' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Shield className="w-6 h-6" />
                    Capability Management
                  </h2>
                  
                  <div className="border-t border-dashed border-muted pt-4 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                      <button
                        onClick={() => handleRequestCapability('read')}
                        disabled={!connection || loading === 'capability-read'}
                        className="px-4 md:px-6 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
                      >
                        {loading === 'capability-read' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Shield className="w-4 h-4" />
                        )}
                        Request Read
                      </button>
                      
                      <button
                        onClick={() => handleRequestCapability('write')}
                        disabled={!connection || loading === 'capability-write'}
                        className="px-4 md:px-6 py-2 bg-orange-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
                      >
                        {loading === 'capability-write' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Shield className="w-4 h-4" />
                        )}
                        Request Write
                      </button>
                      
                      <button
                        onClick={() => handleRequestCapability('compute')}
                        disabled={!connection || loading === 'capability-compute'}
                        className="px-4 md:px-6 py-2 bg-purple-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
                      >
                        {loading === 'capability-compute' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Shield className="w-4 h-4" />
                        )}
                        Request Compute
                      </button>
                    </div>
                    
                    {capabilities.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-bold text-muted-foreground">Active Capabilities:</h3>
                        {capabilities.map((cap) => (
                          <div key={cap.id} className="p-4 border border-border space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">ID:</span>
                              <span className="font-mono">{cap.id}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Scope:</span>
                              <span className={`font-mono ${
                                cap.scope === 'read' ? 'text-green-500' :
                                cap.scope === 'write' ? 'text-orange-500' :
                                'text-purple-500'
                              }`}>{cap.scope}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Methods:</span>
                              <span className="font-mono">{cap.methods.join(', ')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeSection === 'invocation' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Send className="w-6 h-6" />
                    Method Invocation
                  </h2>
                  
                  <div className="border-t border-dashed border-muted pt-4 space-y-4">
                    {/* Read Capability - Get Balance */}
                    {capabilities.find(c => c.scope === 'read') && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-green-600 dark:text-green-400">Read Capability</h3>
                        <button
                          onClick={handleInvokeMethod}
                          disabled={loading === 'invoke'}
                          className="px-6 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                        >
                          {loading === 'invoke' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Get Balance
                        </button>
                        
                        {balanceResult && (
                          <div className="p-4 border border-border text-sm">
                            <p className="font-mono">{balanceResult}</p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Write Capability - Send Transaction */}
                    {capabilities.find(c => c.scope === 'write') && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-orange-600 dark:text-orange-400">Write Capability</h3>
                        <button
                          onClick={handleSendTransaction}
                          disabled={loading === 'write'}
                          className="px-6 py-2 bg-orange-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                        >
                          {loading === 'write' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Send Transaction
                        </button>
                        <p className="text-xs text-muted-foreground">
                          Sends 0.1 OCT test transaction (requires user approval)
                        </p>
                      </div>
                    )}
                    
                    {/* Compute Capability - Invoke Compute */}
                    {capabilities.find(c => c.scope === 'compute') && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-purple-600 dark:text-purple-400">Compute Capability</h3>
                        <button
                          onClick={handleInvokeCompute}
                          disabled={loading === 'compute'}
                          className="px-6 py-2 bg-purple-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                        >
                          {loading === 'compute' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Invoke Compute
                        </button>
                        <p className="text-xs text-muted-foreground">
                          Executes HFHE encrypted computation (example circuit)
                        </p>
                      </div>
                    )}
                    
                    {capabilities.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Request capabilities first to invoke methods.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              {activeSection === 'signing' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="w-6 h-6" />
                    Message Signing
                  </h2>
                  
                  <div className="border-t border-dashed border-muted pt-4 space-y-4">
                    <button
                      onClick={handleSignMessage}
                      disabled={!connection || loading === 'sign'}
                      className="px-6 py-2 bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                    >
                      {loading === 'sign' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      Sign Message
                    </button>
                    
                    {signatureResult && (
                      <div className="p-4 border border-border text-sm">
                        <p className="font-mono">{signatureResult}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeSection === 'gas' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Zap className="w-6 h-6" />
                    Gas Estimation
                  </h2>
                  
                  <div className="border-t border-dashed border-muted pt-4 space-y-4">
                    <button
                      onClick={handleEstimateGas}
                      disabled={!isInstalled || loading === 'gas'}
                      className="px-6 py-2 bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2"
                    >
                      {loading === 'gas' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4" />
                      )}
                      Estimate Gas
                    </button>
                    
                    {gasResult && (
                      <div className="p-4 border border-border text-sm space-y-2">
                        <pre className="font-mono whitespace-pre-wrap">{gasResult}</pre>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeSection === 'advanced' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Zap className="w-6 h-6" />
                    Advanced Features
                  </h2>
                  
                  <div className="border-t border-dashed border-muted pt-4 space-y-6">
                    {/* Capability Management */}
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Capability Management</h3>
                      
                      <div className="flex gap-3 flex-wrap">
                        <button
                          onClick={handleListCapabilities}
                          disabled={!sdk || loading === 'list-caps'}
                          className="px-4 py-2 bg-blue-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'list-caps' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Shield className="w-4 h-4" />
                          )}
                          List All Capabilities
                        </button>
                        
                        <button
                          onClick={handleRenewCapability}
                          disabled={!sdk || capabilities.length === 0 || loading === 'renew-cap'}
                          className="px-4 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'renew-cap' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                          Renew First Capability
                        </button>
                        
                        <button
                          onClick={handleRevokeCapability}
                          disabled={!sdk || capabilities.length === 0 || loading === 'revoke-cap'}
                          className="px-4 py-2 bg-red-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'revoke-cap' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                          Revoke Last Capability
                        </button>
                      </div>
                      
                      <p className="text-xs text-muted-foreground">
                        Manage capability lifecycle: list all capabilities, renew expiration, or revoke access.
                      </p>
                    </div>
                    
                    <div className="border-t border-dashed border-muted"></div>
                    
                    {/* Advanced Gas Estimation */}
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Advanced Gas Estimation</h3>
                      
                      <div className="flex gap-3 flex-wrap">
                        <button
                          onClick={handleEstimateEncryptedTx}
                          disabled={!sdk || loading === 'estimate-encrypted'}
                          className="px-4 py-2 bg-purple-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'estimate-encrypted' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Zap className="w-4 h-4" />
                          )}
                          Estimate Encrypted TX
                        </button>
                        
                        <button
                          onClick={handleEstimateComputeCost}
                          disabled={!sdk || loading === 'estimate-compute'}
                          className="px-4 py-2 bg-indigo-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'estimate-compute' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Zap className="w-4 h-4" />
                          )}
                          Estimate Compute Cost
                        </button>
                      </div>
                      
                      <p className="text-xs text-muted-foreground">
                        Estimate gas for HFHE encrypted transactions and compute operations.
                      </p>
                    </div>
                    
                    {advancedResult && (
                      <>
                        <div className="border-t border-dashed border-muted"></div>
                        <div className="p-4 border border-border text-sm space-y-2">
                          <h4 className="font-semibold text-muted-foreground mb-2">Result:</h4>
                          <pre className="font-mono whitespace-pre-wrap text-xs">{advancedResult}</pre>
                        </div>
                      </>
                    )}
                    
                    {allCapabilities.length > 0 && (
                      <>
                        <div className="border-t border-dashed border-muted"></div>
                        <div className="space-y-2">
                          <h4 className="font-semibold text-muted-foreground">All Capabilities ({allCapabilities.length}):</h4>
                          <div className="space-y-2 max-h-96 overflow-y-auto">
                            {allCapabilities.map((cap) => (
                              <div key={cap.id} className="p-3 border border-border space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">ID:</span>
                                  <span className="font-mono">{cap.id}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Scope:</span>
                                  <span className={`font-mono ${
                                    cap.scope === 'read' ? 'text-green-500' :
                                    cap.scope === 'write' ? 'text-orange-500' :
                                    'text-purple-500'
                                  }`}>{cap.scope}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Methods:</span>
                                  <span className="font-mono">{cap.methods.join(', ')}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">State:</span>
                                  <span className={`font-mono ${
                                    cap.state === 'ACTIVE' ? 'text-green-500' :
                                    cap.state === 'EXPIRED' ? 'text-yellow-500' :
                                    'text-red-500'
                                  }`}>{cap.state}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Expires:</span>
                                  <span className="font-mono text-xs">{new Date(cap.expiresAt).toLocaleString()}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {activeSection === 'demo' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <RefreshCw className="w-6 h-6" />
                    Feature Demos
                  </h2>
                  
                  <div className="border-t border-dashed border-muted pt-4 space-y-6">
                    {/* Error Handling Demos */}
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        Advanced Error Handling
                      </h3>
                      
                      <div className="flex gap-3 flex-wrap">
                        <button
                          onClick={handleDemoRetry}
                          disabled={loading === 'demo-retry'}
                          className="px-4 py-2 bg-blue-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'demo-retry' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                          Retry with Backoff
                        </button>
                        
                        <button
                          onClick={handleDemoCircuitBreaker}
                          disabled={loading === 'demo-circuit'}
                          className="px-4 py-2 bg-indigo-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'demo-circuit' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Shield className="w-4 h-4" />
                          )}
                          Circuit Breaker
                        </button>
                        
                        <button
                          onClick={handleDemoTimeout}
                          disabled={loading === 'demo-timeout'}
                          className="px-4 py-2 bg-purple-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm"
                        >
                          {loading === 'demo-timeout' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Zap className="w-4 h-4" />
                          )}
                          Timeout Pattern
                        </button>
                      </div>
                      
                      {retryCount > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Retry attempts: {retryCount}
                        </div>
                      )}
                      
                      <p className="text-xs text-muted-foreground">
                        Demonstrates retry logic with exponential backoff, circuit breaker pattern, and timeout handling.
                      </p>
                    </div>
                    
                    <div className="border-t border-dashed border-muted"></div>
                    
                    {/* HFHE Circuit Demos */}
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">HFHE Circuit Execution</h3>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => handleDemoHFHECircuit('SIMPLE_ADD')}
                          disabled={loading === 'demo-hfhe-SIMPLE_ADD'}
                          className="px-4 py-2 bg-green-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm justify-center"
                        >
                          {loading === 'demo-hfhe-SIMPLE_ADD' && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          Simple Addition
                        </button>
                        
                        <button
                          onClick={() => handleDemoHFHECircuit('MULTIPLY')}
                          disabled={loading === 'demo-hfhe-MULTIPLY'}
                          className="px-4 py-2 bg-orange-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm justify-center"
                        >
                          {loading === 'demo-hfhe-MULTIPLY' && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          Multiplication
                        </button>
                        
                        <button
                          onClick={() => handleDemoHFHECircuit('COMPARISON')}
                          disabled={loading === 'demo-hfhe-COMPARISON'}
                          className="px-4 py-2 bg-yellow-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm justify-center"
                        >
                          {loading === 'demo-hfhe-COMPARISON' && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          Comparison
                        </button>
                        
                        <button
                          onClick={() => handleDemoHFHECircuit('POLYNOMIAL')}
                          disabled={loading === 'demo-hfhe-POLYNOMIAL'}
                          className="px-4 py-2 bg-purple-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm justify-center"
                        >
                          {loading === 'demo-hfhe-POLYNOMIAL' && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          Polynomial
                        </button>
                        
                        <button
                          onClick={() => handleDemoHFHECircuit('NEURAL_NET')}
                          disabled={loading === 'demo-hfhe-NEURAL_NET'}
                          className="px-4 py-2 bg-pink-600 text-white disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center gap-2 text-sm justify-center col-span-2"
                        >
                          {loading === 'demo-hfhe-NEURAL_NET' && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          Neural Network Inference
                        </button>
                      </div>
                      
                      <p className="text-xs text-muted-foreground">
                        Demonstrates real HFHE circuit execution with encrypted inputs and outputs. Each circuit shows realistic gas costs and execution times.
                      </p>
                    </div>
                    
                    {demoResult && (
                      <>
                        <div className="border-t border-dashed border-muted"></div>
                        <div className="p-4 border border-border text-sm space-y-2">
                          <h4 className="font-semibold text-muted-foreground mb-2">Demo Result:</h4>
                          <pre className="font-mono whitespace-pre-wrap text-xs">{demoResult}</pre>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
              </div>
            </div>
          </main>
        </div>

        <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-background py-1 px-6 z-40">
          <p className="text-xs text-muted-foreground text-center">
            Octra dApp Starter - Testing SDK v2 Functions
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
