import * as vscode from "vscode";
import { WebSocketServer } from "ws";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type DevServer = {
  port: number;
  stop: () => void;
};

export function startDevServer(): DevServer {
  const port = 38947;
  const wss = new WebSocketServer({ port });
  vscode.window.showInformationMessage(
    `Drift Dev server listening on ws://localhost:${port}`,
  );
  const clients: any[] = [];

  wss.on("connection", (ws: any, req: any) => {
    const addr = req.socket.remoteAddress;
    console.log("Drift Dev client connected from", addr);
    clients.push(ws);
    let currentFile: string | null = null;

    ws.on("close", () => {
      const idx = clients.indexOf(ws);
      if (idx >= 0) clients.splice(idx, 1);
    });

    ws.on("message", async (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "hello") {
          // No token required in dev mode — accept hello and ack
          ws.send(JSON.stringify({ type: "ack", what: "hello" }));
        } else if (msg.type === "tables") {
          // Forward tables to the extension via a command so the tree can update
          try {
            await vscode.commands.executeCommand(
              "drift-studio.devTables",
              msg.tables,
            );
          } catch (e) {
            console.log("tables:", msg.tables);
          }
        } else if (msg.type === "table_data") {
          // Forward table rows (and optional error) to extension
          try {
            const payload = { rows: msg.rows, error: msg.error };
            await vscode.commands.executeCommand(
              "drift-studio.tableData",
              msg.table,
              payload,
            );
          } catch (e) {
            console.log("table_data:", msg.table, e);
          }
        } else if (msg.type === "db_file_meta") {
          currentFile = path.join(
            os.tmpdir(),
            `drift-${Date.now()}-${msg.name}`,
          );
          fs.writeFileSync(currentFile, Buffer.from([]));
          ws.send(JSON.stringify({ type: "ack", what: "ready_for_chunks" }));
        } else if (msg.type === "db_file_chunk") {
          if (!currentFile) {
            return;
          }
          const buf = Buffer.from(msg.data, "base64");
          fs.appendFileSync(currentFile, buf);
          if (msg.final) {
            vscode.window.showInformationMessage(`DB received: ${currentFile}`);
            ws.send(
              JSON.stringify({
                type: "ack",
                what: "db_received",
                path: currentFile,
              }),
            );
            // Optional: trigger a command in the extension to open the DB file
            try {
              const uri = vscode.Uri.file(currentFile);
              await vscode.commands.executeCommand(
                "drift-studio.openDbFile",
                uri,
              );
            } catch (e) {
              // command may not exist yet; ignore
            }
          }
        }
      } catch (e) {
        console.error("devServer message parse error", e);
      }
    });
  });

  // Allow extension to request table rows from connected clients
  vscode.commands.registerCommand(
    "drift-studio.requestTableData",
    (table: string, opts?: any) => {
      try {
        const msg: any = { type: "request_table", table };
        if (opts && typeof opts === "object") Object.assign(msg, opts);
        if (clients.length === 0) {
          // No clients connected: notify extension so UI can show message
          try {
            // forward requested limit if present so extension fallback can use it
            const payload: any = { rows: [], error: "no_clients" };
            if (typeof msg.limit !== "undefined") payload.limit = msg.limit;
            vscode.commands.executeCommand(
              "drift-studio.tableData",
              table,
              payload,
            );
          } catch (_) {}
          return;
        }
        for (const c of clients) {
          try {
            c.send(JSON.stringify(msg));
          } catch (_) {}
        }
      } catch (e) {
        console.error("requestTableData error", e);
      }
    },
  );

  return {
    port,
    stop: () => {
      try {
        wss.close();
      } catch (e) {
        // ignore
      }
      vscode.window.showInformationMessage("Drift Dev server stopped");
    },
  };
}
