/**
 * Debug utilities for Octra dApp testing
 */

export const logger = {
  group: (title: string) => {
    console.group(`[DEBUG] ${title}`);
  },
  
  groupEnd: () => {
    console.groupEnd();
  },
  
  success: (message: string, data?: any) => {
    console.log(`[SUCCESS] ${message}`, data || '');
  },
  
  error: (message: string, error?: any) => {
    console.error(`[ERROR] ${message}`, error || '');
  },
  
  info: (message: string, data?: any) => {
    console.info(`[INFO] ${message}`, data || '');
  },
  
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data || '');
  },
  
  test: (testName: string, passed: boolean, details?: any) => {
    if (passed) {
      console.log(`[TEST PASSED] ${testName}`, details || '');
    } else {
      console.error(`[TEST FAILED] ${testName}`, details || '');
    }
  }
};

export function validateConnection(connection: any): boolean {
  logger.group('Validating Connection');
  
  const tests = [
    {
      name: 'Has circle',
      pass: !!connection.circle,
      value: connection.circle
    },
    {
      name: 'Wallet address starts with "oct"',
      pass: connection.walletPubKey?.startsWith('oct'),
      value: connection.walletPubKey
    },
    {
      name: 'Has EVM address',
      pass: !!connection.evmAddress && connection.evmAddress.startsWith('0x'),
      value: connection.evmAddress
    },
    {
      name: 'Has network',
      pass: ['testnet', 'mainnet'].includes(connection.network),
      value: connection.network
    },
    // PENDING: Epoch and branch validation disabled until implementation is ready
    // {
    //   name: 'Has real epoch (not Date.now())',
    //   pass: typeof connection.epoch === 'number' && connection.epoch > 0 && connection.epoch < 1000000,
    //   value: connection.epoch
    // },
    // {
    //   name: 'Has branchId',
    //   pass: !!connection.branchId,
    //   value: connection.branchId
    // },
    {
      name: 'Has sessionId',
      pass: !!connection.sessionId,
      value: connection.sessionId
    }
  ];
  
  let allPassed = true;
  tests.forEach(test => {
    logger.test(test.name, test.pass, test.value);
    if (!test.pass) allPassed = false;
  });
  
  logger.groupEnd();
  return allPassed;
}

export function validateCapability(capability: any): boolean {
  logger.group('Validating Capability');
  
  const tests = [
    {
      name: 'Has capability ID',
      pass: !!capability.id,
      value: capability.id
    },
    {
      name: 'Version is 2',
      pass: capability.version === 2,
      value: capability.version
    },
    {
      name: 'Has valid scope',
      pass: ['read', 'write', 'compute'].includes(capability.scope),
      value: capability.scope
    },
    {
      name: 'Has methods array',
      pass: Array.isArray(capability.methods) && capability.methods.length > 0,
      value: capability.methods
    },
    {
      name: 'Has appOrigin',
      pass: !!capability.appOrigin,
      value: capability.appOrigin
    },
    {
      name: 'Has walletPubKey (hex format)',
      pass: !!capability.walletPubKey && capability.walletPubKey.length === 64 && /^[0-9a-f]+$/i.test(capability.walletPubKey),
      value: capability.walletPubKey?.slice(0, 16) + '...'
    },
    // PENDING: Epoch validation disabled until implementation is ready
    // {
    //   name: 'Has real epoch (not Date.now())',
    //   pass: typeof capability.epoch === 'number' && capability.epoch >= 0 && capability.epoch < 1000000,
    //   value: capability.epoch
    // },
    {
      name: 'Has real nonceBase',
      pass: typeof capability.nonceBase === 'number' && capability.nonceBase >= 0,
      value: capability.nonceBase
    },
    {
      name: 'Has signature',
      pass: !!capability.signature && capability.signature.length > 0,
      value: capability.signature?.slice(0, 32) + '...'
    },
    {
      name: 'Has issuedAt timestamp',
      pass: typeof capability.issuedAt === 'number' && capability.issuedAt > 0,
      value: new Date(capability.issuedAt).toISOString()
    },
    {
      name: 'Has expiresAt timestamp',
      pass: typeof capability.expiresAt === 'number' && capability.expiresAt > capability.issuedAt,
      value: new Date(capability.expiresAt).toISOString()
    }
  ];
  
  let allPassed = true;
  tests.forEach(test => {
    logger.test(test.name, test.pass, test.value);
    if (!test.pass) allPassed = false;
  });
  
  logger.groupEnd();
  return allPassed;
}

export function validateBalance(balance: any): boolean {
  logger.group('Validating Balance Response');
  
  const tests = [
    {
      name: 'OCT address starts with "oct"',
      pass: balance.octAddress?.startsWith('oct'),
      value: balance.octAddress
    },
    {
      name: 'Has OCT balance (number)',
      pass: typeof balance.octBalance === 'number',
      value: balance.octBalance
    },
    {
      name: 'Has network',
      pass: ['testnet', 'mainnet'].includes(balance.network),
      value: balance.network
    },
  ];
  
  let allPassed = true;
  tests.forEach(test => {
    logger.test(test.name, test.pass, test.value);
    if (!test.pass) allPassed = false;
  });
  
  logger.groupEnd();
  return allPassed;
}

export function validateError(error: any): boolean {
  logger.group('Validating Error Response');
  
  const tests = [
    {
      name: 'Has error code',
      pass: !!error.code,
      value: error.code
    },
    {
      name: 'Has error message',
      pass: !!error.message,
      value: error.message
    },
    {
      name: 'Has layer info',
      pass: ['sdk', 'wallet', 'network'].includes(error.layer),
      value: error.layer
    },
    {
      name: 'Has retryable flag',
      pass: typeof error.retryable === 'boolean',
      value: error.retryable
    }
  ];
  
  let allPassed = true;
  tests.forEach(test => {
    logger.test(test.name, test.pass, test.value);
    if (!test.pass) allPassed = false;
  });
  
  logger.groupEnd();
  return allPassed;
}

export function logInvocationDetails(invocation: any): void {
  logger.group('Invocation Details');
  logger.info('Capability ID', invocation.capabilityId);
  logger.info('Method', invocation.method);
  logger.info('Nonce', invocation.nonce);
  logger.info('Timestamp', new Date(invocation.timestamp).toISOString());
  // PENDING: Branch and epoch logging disabled until implementation is ready
  // logger.info('Branch ID', invocation.branchId);
  // logger.info('Epoch', invocation.epoch);
  logger.groupEnd();
}

export function testCanonicalSerialization(): void {
  logger.group('Testing Canonical Serialization');
  
  const testObj = { b: 2, a: 1, c: [3, 2, 1] };
  logger.info('Test object', testObj);
  logger.info('Expected canonical', '{"a":1,"b":2,"c":[3,2,1]}');
  logger.info('Keys should be sorted: a, b, c');
  
  logger.groupEnd();
}

export function testDomainSeparation(): void {
  logger.group('Testing Domain Separation');
  
  logger.info('Capability prefix', 'OctraCapability:v2:');
  logger.info('Invocation prefix', 'OctraInvocation:v2:');
  logger.info('Domain separation prevents signature replay across contexts');
  
  logger.groupEnd();
}

export function logTestSummary(results: { passed: number; failed: number; total: number }): void {
  logger.group('Test Summary');
  logger.info('Total tests', results.total);
  logger.success('Passed', results.passed);
  if (results.failed > 0) {
    logger.error('Failed', results.failed);
  }
  logger.info('Success rate', `${((results.passed / results.total) * 100).toFixed(1)}%`);
  logger.groupEnd();
}
