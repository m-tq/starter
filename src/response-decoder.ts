/**
 * Enhanced Response Decoder with Full Type Support
 * Provides type-safe decoding for all SDK response types
 */

import type { InvocationResult } from '@octwa/sdk';

// Response type definitions
export interface BalanceResponse {
  octBalance: number;
}

export interface TransactionResponse {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  blockNumber?: number;
  gasUsed?: number;
  fee?: number;
}

export interface ComputeResponse {
  computeId: string;
  status: 'queued' | 'computing' | 'completed' | 'failed';
  result?: Uint8Array;
  gasUsed?: number;
  executionTime?: number;
}

export interface SignatureResponse {
  signature: string;
  publicKey: string;
  algorithm: 'Ed25519';
}

export interface GasEstimateResponse {
  gasUnits: number;
  tokenCost: number;
  estimatedTime?: number;
}

/**
 * Generic response decoder with type safety
 */
export class ResponseDecoder {
  /**
   * Decode raw response data to typed object
   */
  static decode<T = unknown>(result: InvocationResult): T {
    if (!result.success) {
      throw new Error(result.error || 'Invocation failed');
    }

    let responseData: unknown = result.data;
    
    // Handle nested result structure
    const resultAny = result as unknown as { result?: { data?: unknown } };
    if (!responseData && resultAny.result?.data) {
      responseData = resultAny.result.data;
    }

    if (!responseData) {
      throw new Error('Empty response data');
    }

    // Convert to Uint8Array if needed
    const bytes = this.toUint8Array(responseData);
    
    if (!bytes) {
      // Already a parsed object
      return responseData as T;
    }

    // Decode and parse JSON
    const decoded = new TextDecoder().decode(bytes);
    return JSON.parse(decoded) as T;
  }

  /**
   * Convert various formats to Uint8Array
   */
  private static toUint8Array(data: unknown): Uint8Array | null {
    if (data instanceof Uint8Array) {
      return data;
    }
    
    if (Array.isArray(data)) {
      return new Uint8Array(data);
    }
    
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      const keys = Object.keys(obj);

      // Check if object has numeric keys (serialized Uint8Array)
      if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
        const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));
        const arr = sortedKeys.map(k => obj[k] as number);
        return new Uint8Array(arr);
      }
    }
    
    return null;
  }

  /**
   * Decode balance response
   */
  static decodeBalance(result: InvocationResult): BalanceResponse {
    const data = this.decode<BalanceResponse>(result);
    
    // Validate structure
    if (typeof data.octBalance !== 'number') {
      throw new Error('Invalid balance response: missing octBalance');
    }
    
    return data;
  }

  /**
   * Decode transaction response
   */
  static decodeTransaction(result: InvocationResult): TransactionResponse {
    const data = this.decode<TransactionResponse>(result);
    
    // Validate structure
    if (!data.txHash || typeof data.txHash !== 'string') {
      throw new Error('Invalid transaction response: missing txHash');
    }
    
    return data;
  }

  /**
   * Decode compute response
   */
  static decodeCompute(result: InvocationResult): ComputeResponse {
    const data = this.decode<ComputeResponse>(result);
    
    // Validate structure
    if (!data.computeId || typeof data.computeId !== 'string') {
      throw new Error('Invalid compute response: missing computeId');
    }
    
    // Convert result to Uint8Array if present
    if (data.result && !(data.result instanceof Uint8Array)) {
      const resultBytes = this.toUint8Array(data.result);
      if (resultBytes) {
        data.result = resultBytes;
      }
    }
    
    return data;
  }

  /**
   * Decode signature response
   */
  static decodeSignature(result: InvocationResult): SignatureResponse {
    const data = this.decode<SignatureResponse>(result);
    
    // Validate structure
    if (!data.signature || typeof data.signature !== 'string') {
      throw new Error('Invalid signature response: missing signature');
    }
    
    return data;
  }

  /**
   * Decode gas estimate response
   */
  static decodeGasEstimate(result: InvocationResult): GasEstimateResponse {
    const data = this.decode<GasEstimateResponse>(result);
    
    // Validate structure
    if (typeof data.gasUnits !== 'number') {
      throw new Error('Invalid gas estimate response: missing gasUnits');
    }
    
    return data;
  }

  /**
   * Safe decode with fallback
   */
  static safeDecode<T>(
    result: InvocationResult,
    fallback: T
  ): T {
    try {
      return this.decode<T>(result);
    } catch {
      return fallback;
    }
  }

  /**
   * Decode with validation function
   */
  static decodeWithValidation<T>(
    result: InvocationResult,
    validator: (data: T) => boolean,
    errorMessage = 'Validation failed'
  ): T {
    const data = this.decode<T>(result);
    
    if (!validator(data)) {
      throw new Error(errorMessage);
    }
    
    return data;
  }
}

/**
 * Helper functions for common response types
 */
export const decodeBalance = (result: InvocationResult) => 
  ResponseDecoder.decodeBalance(result);

export const decodeTransaction = (result: InvocationResult) => 
  ResponseDecoder.decodeTransaction(result);

export const decodeCompute = (result: InvocationResult) => 
  ResponseDecoder.decodeCompute(result);

export const decodeSignature = (result: InvocationResult) => 
  ResponseDecoder.decodeSignature(result);

export const decodeGasEstimate = (result: InvocationResult) => 
  ResponseDecoder.decodeGasEstimate(result);
