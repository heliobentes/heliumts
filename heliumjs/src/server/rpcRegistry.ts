import WebSocket from 'ws';

import type { RpcRequest, RpcResponse } from '../runtime/protocol';
import type { HeliumMethodDef } from './defineMethod';

export class RpcRegistry {
  private methods = new Map<string, HeliumMethodDef<any, any>>();

  register(id: string, def: HeliumMethodDef<any, any>) {
    def.__id = id;
    this.methods.set(id, def);
  }

  async handleMessage(socket: WebSocket, raw: string) {
    let req: RpcRequest;
    try {
      req = JSON.parse(raw);
    } catch {
      return;
    }

    const def = this.methods.get(req.method);
    if (!def) {
      const res: RpcResponse = {
        id: req.id,
        ok: false,
        error: { message: `Unknown method ${req.method}` },
      };
      socket.send(JSON.stringify(res));
      return;
    }

    try {
      const ctx = {}; // TODO: add real context
      const result = await def.handler(req.args, ctx);
      const res: RpcResponse = {
        id: req.id,
        ok: true,
        result,
      };
      socket.send(JSON.stringify(res));
    } catch (err: any) {
      const res: RpcResponse = {
        id: req.id,
        ok: false,
        error: { message: err?.message ?? 'Server error' },
      };
      socket.send(JSON.stringify(res));
    }
  }
}
