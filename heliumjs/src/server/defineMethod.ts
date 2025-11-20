export type HeliumMethodDef<TArgs = any, TResult = any> = {
  __kind: 'method';
  __id: string;
  handler: (args: TArgs, ctx: any) => Promise<TResult> | TResult;
};

export function defineMethod<TArgs, TResult>(
  handler: (args: TArgs, ctx: any) => Promise<TResult> | TResult
): HeliumMethodDef<TArgs, TResult>;

export function defineMethod<TArgs, TResult>(
  id: string,
  handler: (args: TArgs, ctx: any) => Promise<TResult> | TResult
): HeliumMethodDef<TArgs, TResult>;

export function defineMethod<TArgs, TResult>(
  idOrHandler: string | ((args: TArgs, ctx: any) => Promise<TResult> | TResult),
  maybeHandler?: (args: TArgs, ctx: any) => Promise<TResult> | TResult
): HeliumMethodDef<TArgs, TResult> {
  const hasId = typeof idOrHandler === 'string';
  const handler = (hasId ? maybeHandler : idOrHandler) as
    | ((args: TArgs, ctx: any) => Promise<TResult> | TResult)
    | undefined;

  if (!handler) {
    throw new Error('defineMethod requires a handler');
  }

  return {
    __kind: 'method',
    __id: hasId ? (idOrHandler as string) : '',
    handler,
  };
}
