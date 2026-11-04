// A stand-in for the Anthropic Messages API, for local end-to-end tests only. Never used in production.
// Start it, then run the app with ANTHROPIC_BASE_URL=http://127.0.0.1:8899 and any ANTHROPIC_API_KEY.
// Stand-in for the Anthropic Messages API, for local end-to-end tests only.
const http = require('http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => { 
    const j = JSON.parse(body);
    const last = j.messages[j.messages.length - 1];
    let content;
    if (j.tools && j.tools.some((t) => t.name === 'list_transactions')) {
      const hasResult = Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result');
      content = hasResult
        ? [{ type: 'text', text: JSON.stringify({ carers: [
            { payeeName: 'Maria Lopez', payeeEmail: 'maria@example.com', amountPerPaymentMinor: 32000, cadence: 'WEEKLY', why: 'You pay Maria $320 most Fridays, with notes about care at home.' },
            { payeeName: 'Priya', payeeEmail: 'priya@example.com', amountPerPaymentMinor: 5000, cadence: 'MONTHLY', why: 'Monthly transfer.' } ] }) }]
        : [{ type: 'tool_use', id: 'tu_1', name: 'list_transactions', input: {} }];
    } else {
      content = [{ type: 'text', text: 'I paused this because someone new is asking for $1,200 in gift cards, and says it is urgent. Real companies never ask for gift cards. What did the person on the phone tell you?' }];
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn' }));
  });
}).listen(8899);
