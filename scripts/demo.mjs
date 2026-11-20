import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const pagePath = '/fixtures/field-notes.html';
const page = await readFile(new URL('..' + pagePath, import.meta.url));
const port = 4173;
const host = '127.0.0.1';

const server = createServer((request, response) => {
  const path = request.url?.split('?')[0];
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (path === '/') {
    response.writeHead(302, { Location: pagePath }).end();
    return;
  }
  if (path !== pagePath) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': page.length,
    'Cache-Control': 'no-store',
  });
  response.end(request.method === 'HEAD' ? undefined : page);
});

server.listen(port, host, () => {
  console.log('Field Notes demo at http://' + host + ':' + port + pagePath);
});
