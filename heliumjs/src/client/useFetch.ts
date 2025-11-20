import { useCallback, useEffect, useState } from 'react';

import { cacheKey, get, has, set, subscribeInvalidations } from './cache';
import { rpcCall } from './rpcClient';

export type MethodStub<_TArgs = unknown, _TResult = unknown> = {
  __id: string;
  // we can add more metadata later
};

if (true) console.log('useFetch module loaded');

export function useFetch<_TArgs = unknown, _TResult = unknown>(
  method: MethodStub<_TArgs, _TResult>,
  args?: _TArgs
) {
  const key = cacheKey(method.__id, args);

  const [data, setData] = useState<_TResult | undefined>(() =>
    has(key) ? get<_TResult>(key) : undefined
  );
  const [isLoading, setLoading] = useState(!has(key));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;

    if (!has(key)) {
      setLoading(true);
      setError(null);

      rpcCall<_TResult, _TArgs>(method.__id, args as _TArgs)
        .then((result) => {
          if (!active) return;
          set(key, result);
          setData(result);
        })
        .catch((err) => {
          if (active) setError(err);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [key, method.__id]);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await rpcCall<_TResult, _TArgs>(method.__id, args as _TArgs);
      set(key, result);
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [args, key, method.__id]);

  useEffect(() => {
    const unsubscribe = subscribeInvalidations((methodId) => {
      if (methodId === method.__id) {
        refetch();
      }
    });

    return unsubscribe;
  }, [method.__id, refetch]);

  return { data, isLoading, error, refetch };
}
