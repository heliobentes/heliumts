import { useState } from 'react';

import { invalidateByMethod } from './cache';
import { rpcCall } from './rpcClient';
import type { MethodStub } from './useFetch';

type UseCallOptions = {
  invalidate?: MethodStub[];
  onSuccess?: (result: unknown) => void;
};

export function useCall<_TArgs = unknown, _TResult = unknown>(
  method: MethodStub<_TArgs, _TResult>,
  options: UseCallOptions = {}
) {
  const [isCalling, setCalling] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function call(args: _TArgs): Promise<_TResult> {
    setCalling(true);
    setError(null);
    try {
      const result = await rpcCall<_TResult, _TArgs>(method.__id, args);
      options.invalidate?.forEach((m) => invalidateByMethod(m.__id));
      options.onSuccess?.(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setCalling(false);
    }
  }

  return { call, isCalling, error };
}
