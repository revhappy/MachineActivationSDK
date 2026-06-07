import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import type { Catalog } from '../../src/catalog';

export interface CatalogServer {
  baseUrl: string;
  catalogUrl: string;
  close(): Promise<void>;
}

/**
 * Spin up a tiny in-process HTTP server that serves:
 *   GET /catalog.json   → the supplied catalog as JSON
 *   GET /<anything>     → `archives[url.pathname]` bytes, if registered
 */
export function startCatalogServer(args: {
  catalog: Catalog;
  archives: Record<string, Buffer>;
}): Promise<CatalogServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end();
        return;
      }
      if (req.url === '/catalog.json') {
        const body = JSON.stringify(args.catalog);
        res.setHeader('content-type', 'application/json');
        res.setHeader('content-length', Buffer.byteLength(body).toString());
        res.end(body);
        return;
      }
      const archive = args.archives[req.url];
      if (archive) {
        res.setHeader('content-type', 'application/zip');
        res.setHeader('content-length', archive.length.toString());
        res.end(archive);
        return;
      }
      res.statusCode = 404;
      res.end(`not found: ${req.url}`);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        catalogUrl: `${baseUrl}/catalog.json`,
        close() {
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
