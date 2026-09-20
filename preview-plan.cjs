// Local preview for T3's Browser tab. Run: node preview-plan.cjs
// Avoids the installed T3 asset server's compressed-response MIME issue.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const host = '127.0.0.1';
const port = 8765;
const filename = 'ever-outward-plan.html';

const server = http.createServer(async (request, response) => {
  const pathname = request.url.split('?')[0];
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  if (pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname !== '/' && pathname !== '/' + filename) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  try {
    const html = await fs.readFile(path.join(__dirname, filename));
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Could not read ' + filename);
  }
});

server.on('error', (error) => {
  console.error('Preview could not start: ' + error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log('Plan preview: http://' + host + ':' + port + '/' + filename);
});
