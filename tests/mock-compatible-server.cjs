const http = require('node:http');

const responseBody = {
  choices: [{ message: { content: JSON.stringify({ questions: [{ number: 1, latexText: '테스트', indirectStem: '', directStem: '테스트', choices: [], questionBox: [0.1, 0.1, 0.8, 0.8], hasFigure: false, figureBox: null }] }) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 500 },
};

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(responseBody));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(`http://127.0.0.1:${address.port}/v1`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
