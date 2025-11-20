import type { RpcRequest, RpcResponse } from '../runtime/protocol';

let socket: WebSocket | null = null;

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

function uuid() {
  return Math.random().toString(36).slice(2);
}

function getSocket(): WebSocket {
  if (socket && socket.readyState === WebSocket.OPEN) return socket;

  const url = `ws://${window.location.hostname}:4001/ws`;
  socket = new WebSocket(url);

  socket.onmessage = (event) => {
    const msg: RpcResponse = JSON.parse(event.data);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(msg.error);
  };

  socket.onclose = () => {
    socket = null;
  };

  return socket;
}

function ensureSocketReady(ws: WebSocket): Promise<WebSocket> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve(ws);
  }

  if (ws.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('error', handleError);
        ws.removeEventListener('close', handleClose);
      };
      const handleOpen = () => {
        cleanup();
        resolve(ws);
      };
      const handleError = () => {
        cleanup();
        reject(new Error('WebSocket connection failed'));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error('WebSocket closed before opening'));
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('error', handleError);
      ws.addEventListener('close', handleClose);
    });
  }

  socket = null;
  return ensureSocketReady(getSocket());
}

export async function rpcCall<TResult = unknown, TArgs = unknown>(
  methodId: string,
  args?: TArgs
): Promise<TResult> {
  const ws = await ensureSocketReady(getSocket());
  const id = uuid();

  const req: RpcRequest = { id, method: methodId, args };

  return new Promise<TResult>((resolve, reject) => {
    // Store generic handlers that take unknown; the wrapper will cast to TResult
    pending.set(id, {
      resolve: (v: unknown) => resolve(v as TResult),
      reject,
    });
    try {
      ws.send(JSON.stringify(req));
    } catch (err) {
      pending.delete(id);
      reject(err);
    }
  });
}
