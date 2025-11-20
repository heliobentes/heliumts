import http from 'http';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';

import { RpcRegistry } from './rpcRegistry';

type LoadHandlersFn = (registry: RpcRegistry) => void;

export function startDevServer(loadHandlers: LoadHandlersFn) {
  const registry = new RpcRegistry();
  loadHandlers(registry);

  const port = Number(process.env.HELIUM_RPC_PORT || 4001);

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (msg: WebSocket.RawData) => {
      registry.handleMessage(socket, msg.toString());
    });
  });

  server.listen(port, () => {
    console.log(`Helium dev RPC server listening on http://localhost:${port}`);
  });
}
