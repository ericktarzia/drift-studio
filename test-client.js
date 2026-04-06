const WebSocket = require("ws");

if (process.argv.length < 3) {
  console.error("Usage: node test-client.js <TOKEN> [HOST]");
  console.error("Example: node test-client.js mytoken localhost");
  process.exit(1);
}

const token = process.argv[2];
const host = process.argv[3] || "localhost";
const url = `ws://${host}:38947`;

console.log("Connecting to", url, "with token", token);
const ws = new WebSocket(url);

ws.on("open", () => {
  console.log("open");
  ws.send(
    JSON.stringify({
      type: "hello",
      appId: "com.example",
      version: "1.0",
      token,
    }),
  );
  ws.send(JSON.stringify({ type: "tables", tables: ["users", "posts"] }));
});

ws.on("message", (m) => {
  try {
    const msg = JSON.parse(m.toString());
    console.log("<-", msg);
  } catch (e) {
    console.log("<- raw", m.toString());
  }
});

ws.on("close", () => console.log("closed"));
ws.on("error", (err) => console.error("error", err && err.message));
