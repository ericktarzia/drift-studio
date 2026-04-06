import * as vscode from "vscode";
import { DriftTreeProvider } from "./driftTreeProvider";
import { findDriftTables, findDriftTableColumns } from "./utils";
import { startDevServer } from "./devServer";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

let sqlite3: any = null;
try {
  // require at runtime to avoid bundling issues; sqlite3 is an optional dependency
  // (added to package.json). If not available, we gracefully skip local queries.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sqlite3 = require("sqlite3").verbose();
} catch (e) {
  sqlite3 = null;
}

export function activate(context: vscode.ExtensionContext) {
  // Status bar indicator to show current source (Classes vs Device)
  const sourceStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  sourceStatus.text = "Drift: Source=Classes";
  sourceStatus.tooltip =
    "Shows whether tables come from code (classes) or the running app (device)";
  sourceStatus.show();
  context.subscriptions.push(sourceStatus);

  function setSourceLabel(s: string) {
    sourceStatus.text = `Drift: Source=${s}`;
  }
  // Comando para abrir webview CRUD de colunas
  const openTableWebviewCommand = vscode.commands.registerCommand(
    "drift-studio.openTableWebview",
    async (args) => {
      const tableName = args?.tableName;
      if (!tableName) {
        vscode.window.showErrorMessage("No table name provided.");
        return;
      }
      // Busca colunas atuais
      // Importação direta para TypeScript (não usar import dinâmico)
      const { findDriftTableColumns } = require("./utils");
      const columns = await findDriftTableColumns(tableName);
      let panel: vscode.WebviewPanel | undefined;
      try {
        vscode.window.showInformationMessage(`Opening table ${tableName}...`);
      } catch (e) {
        // ignore
      }
      try {
        panel = vscode.window.createWebviewPanel(
          "driftStudioTableWebview",
          `Drift Table: ${tableName}`,
          vscode.ViewColumn.Active,
          { enableScripts: true },
        );
        panel.webview.html = getTableWebviewHtml(tableName, columns);
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage(
          `Failed to open table webview: ${String(err)}`,
        );
        return;
      }
      // Handler para mensagens do webview (CRUD)
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "openColumnClass") {
          // Abrir arquivo da tabela e focar na classe
          const dartFiles = await vscode.workspace.findFiles(
            "**/*.dart",
            "**/node_modules/**",
          );
          for (const fileUri of dartFiles) {
            const fileBytes = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(fileBytes).toString("utf8");
            const classRegex = new RegExp(
              `class\\s+${tableName}\\s+extends\\s+Table`,
            );
            if (classRegex.test(content)) {
              // Encontrou a classe, abrir arquivo e revelar linha
              const lines = content.split("\n");
              const lineNumber = lines.findIndex((line) =>
                classRegex.test(line),
              );
              const doc = await vscode.workspace.openTextDocument(fileUri);
              const editor = await vscode.window.showTextDocument(doc, {
                preview: false,
              });
              if (lineNumber >= 0) {
                const pos = new vscode.Position(lineNumber, 0);
                editor.revealRange(
                  new vscode.Range(pos, pos),
                  vscode.TextEditorRevealType.InCenter,
                );
                editor.selection = new vscode.Selection(pos, pos);
              }
              break;
            }
          }
        }
      });
    },
  );
  context.subscriptions.push(openTableWebviewCommand);

  function getTableWebviewHtml(
    tableName: string,
    columns: { name: string; type: string }[],
  ) {
    const colRows = columns
      .map(
        (col: { name: string; type: string }) => `
        <tr>
          <td class="col-link" data-col="${col.name}">${col.name}</td>
          <td>${col.type}</td>
          <!--
          <td>
            <button onclick=\"editColumn('${col.name}', '${col.type}')\">Edit</button>
            <button onclick=\"removeColumn('${col.name}')\">Remove</button>
          </td>
          -->
        </tr>
      `,
      )
      .join("");
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Drift Table: ${tableName}</title>
        <style>
          body { font-family: sans-serif; margin: 1.5em; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ccc; padding: 0.5em; text-align: left; }
          th { background: #f5f5f5; }
          .col-link { color: #007acc; cursor: pointer; text-decoration: underline; }
        </style>
      </head>
      <body>
        <h2>Table: ${tableName}</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><!--<th>Actions</th>--></tr>
          </thead>
          <tbody>
            ${colRows}
          </tbody>
        </table>
        <script>
          const vscode = acquireVsCodeApi();
          // Clique na coluna para abrir a classe
          document.querySelectorAll('.col-link').forEach(td => {
            td.addEventListener('click', () => {
              vscode.postMessage({ type: 'openColumnClass', column: td.dataset.col });
            });
          });
        </script>
        <!--
        <h3>Add Column</h3>
        <form id="addColForm">
          <input id="colName" placeholder="Column name" required />
          <select id="colType" required>
            <option value="IntColumn">IntColumn</option>
            <option value="TextColumn">TextColumn</option>
            <option value="BoolColumn">BoolColumn</option>
            <option value="DateTimeColumn">DateTimeColumn</option>
            <option value="RealColumn">RealColumn</option>
          </select>
          <button type="submit">Add</button>
        </form>
        -->
        <script>
          const vscode = acquireVsCodeApi();
          // document.getElementById('addColForm').addEventListener('submit', (e) => {
          //   e.preventDefault();
          //   vscode.postMessage({ type: 'addColumn', name: colName.value, colType: colType.value });
          //   colName.value = '';
          //   colType.value = 'IntColumn';
          // });
          window.editColumn = (name, type) => {
            const newName = prompt('Edit column name:', name);
            const newType = prompt('Edit column type:', type);
            if (newName && newType) {
              vscode.postMessage({ type: 'editColumn', oldName: name, newName, colType: newType });
            }
          };
          window.removeColumn = (name) => {
            if (confirm('Remove column ' + name + '?')) {
              vscode.postMessage({ type: 'removeColumn', name });
            }
          };
        </script>
      </body>
      </html>
    `;
  }
  const treeProvider = new DriftTreeProvider();
  const treeView = vscode.window.createTreeView("driftStudioExplorer", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  // Dev server will be started after commands are registered

  // Command called by the dev server when it has a list of tables
  const devTablesCommand = vscode.commands.registerCommand(
    "drift-studio.devTables",
    (tables: string[]) => {
      // Do NOT overwrite the Explorer table list (classes). Keep device tables
      // separate and only send them to the DB Viewer when present.
      if (Array.isArray(tables)) {
        const deviceTables = tables.map((t) => String(t)).slice();
        vscode.window.showInformationMessage(
          `Received ${deviceTables.length} table(s) from app (device).`,
        );
        // mark source as device
        try {
          setSourceLabel("Device");
        } catch (_) {}
        // If DB viewer is open, send device tables to it (sorted)
        try {
          if (activeDbViewer) {
            deviceTables.sort((a, b) => a.localeCompare(b));
            activeDbViewer.webview.postMessage({
              type: "tables",
              tables: deviceTables,
            });
            // ensure there's a log entry so users see Device activity in the webview logs
            try {
              activeDbViewer.webview.postMessage({
                type: "log",
                message: `Device: ${deviceTables.length} table(s) received`,
              });
            } catch (_) {}
            try {
              activeDbViewer.webview.postMessage({
                type: "status",
                source: "Device",
              });
            } catch (_) {}
          }
        } catch (_) {}
      }
    },
  );
  context.subscriptions.push(devTablesCommand);

  // Command to handle opening a DB file received from the app
  const openDbFileCommand = vscode.commands.registerCommand(
    "drift-studio.openDbFile",
    async (uri: vscode.Uri) => {
      if (!uri) {
        return;
      }
      // when a DB file arrives, mark source and offer to open viewer
      try {
        setSourceLabel("Device");
      } catch (_) {}
      try {
        if (uri && uri.fsPath) {
          lastDbFilePath = uri.fsPath;
          try {
            const buf = fs.readFileSync(lastDbFilePath);
            const b64 = buf.toString("base64");
            if (activeDbViewer) {
              activeDbViewer.webview.postMessage({
                type: "dbBytes",
                name: path.basename(lastDbFilePath),
                data: b64,
              });
              lastDbBytesSentAt = Date.now();
              activeDbViewer.webview.postMessage({
                type: "log",
                message: `Sent DB bytes to webview (${lastDbFilePath})`,
              });
            }
          } catch (e) {
            console.error("Failed to read DB file for webview", e);
          }
        }
      } catch (_) {}
      const choice = await vscode.window.showInformationMessage(
        `App sent a DB file: ${uri.fsPath}`,
        "Reveal File",
        "Open Containing Folder",
        "Open DB Viewer",
        "Ignore",
      );
      // Offer quick open of DB viewer or other actions
      if (choice === "Reveal File") {
        await vscode.commands.executeCommand("revealFileInOS", uri);
      } else if (choice === "Open Containing Folder") {
        const folder = vscode.Uri.file(path.dirname(uri.fsPath));
        await vscode.commands.executeCommand("revealFileInOS", folder);
      } else if (choice === "Open DB Viewer") {
        // If we already have a table list (sent by the app), open viewer with the first table.
        try {
          const tables = (treeProvider as any).getTables
            ? (treeProvider as any).getTables()
            : [];
          const first =
            Array.isArray(tables) && tables.length > 0 ? tables[0] : undefined;
          await vscode.commands.executeCommand(
            "drift-studio.openDbViewer",
            first ? { tableName: first } : undefined,
          );
        } catch (e) {
          // fallback to opening viewer without a table
          await vscode.commands.executeCommand("drift-studio.openDbViewer");
        }
      }
    },
  );
  context.subscriptions.push(openDbFileCommand);

  // Start the dev WebSocket server automatically for app connections
  const devServer = startDevServer();
  context.subscriptions.push({ dispose: () => devServer.stop() });

  // Keep reference to active DB viewer panel so we can push table data into it
  let activeDbViewer: vscode.WebviewPanel | null = null;
  let activeViewerTable: string | null = null;
  let lastDbFilePath: string | null = null;
  let localConnected = false;
  let lastDbBytesSentAt: number | null = null;
  let lastRequestedLimit: number = 200;

  // Command to open DB viewer webview (skeleton)
  const openDbViewerCommand = vscode.commands.registerCommand(
    "drift-studio.openDbViewer",
    async (args?: any) => {
      const panel = vscode.window.createWebviewPanel(
        "driftDbViewer",
        "Drift DB Viewer",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
      );

      const nonce = new Date().getTime();
      panel.webview.html = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          :root { --sidebar-width: 280px; }
          body { font-family: sans-serif; margin: 0; height: 100vh; display:flex; flex-direction:column }
          .toolbar { padding: 8px; background:#f3f3f3; display:flex; gap:8px; align-items:center }
          .toolbar button { padding:6px 10px }
          .viewer { display:flex; flex:1; height: calc(100vh - 46px); }
          .sidebar { width: var(--sidebar-width); border-right:1px solid #e0e0e0; overflow:auto; }
          .sidebar .title { padding:10px; font-weight:600; border-bottom:1px solid #eee }
          .tables { list-style:none; margin:0; padding:0; }
          .tables li { padding:8px 12px; cursor:pointer; border-bottom:1px solid #fafafa }
          .tables li:hover { background:#f5faff }
          .tables li.selected { background:#e6f0ff; font-weight:600 }
          .main { flex:1; padding:12px; overflow:auto }
          .main .table-title { font-size:1.1em; margin-bottom:8px }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 6px; }
          th { background:#fafafa }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button id="refresh">Refresh</button>
          <button id="connect">Connect</button>
          <button id="disconnect">Disconnect</button>
          <select id="rowLimit" style="margin-left:8px;padding:6px;border:1px solid #ddd;border-radius:4px">
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
            <option value="0">All</option>
          </select>
          <input id="search" placeholder="Search rows..." style="flex:1;min-width:200px;padding:6px;border:1px solid #ddd;border-radius:4px" />
          <button id="toggleLogs">Logs</button>
          <span id="status" style="margin-left:12px;color:#666">Source: Classes</span>
        </div>
        <div class="viewer">
          <div class="sidebar">
            <div class="title">Tables</div>
            <ul id="tablesList" class="tables"><li style="padding:12px;color:#888">No tables</li></ul>
          </div>
          <div class="main">
            <div class="table-title">No table selected</div>
            <div id="tableArea"><em>No table loaded.</em></div>
          </div>
        </div>
        <div id="logs" style="height:320px;min-height:160px;overflow:auto;display:block;border-top:1px solid #eee;padding:8px;background:#fff;font-family:monospace;font-size:13px;color:#222"></div>
        <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js"></script>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const tablesList = document.getElementById('tablesList');
          const tableArea = document.getElementById('tableArea');
          const logsDiv = document.getElementById('logs');
          const tableTitle = document.querySelector('.table-title');
          let selectedTable = null;
          let requestTimeout = null;
          let currentRows = [];
          let currentSearch = '';
          let currentSort = { col: null, dir: 1 };
          let currentLimit = 200; // 0 = all
          let currentColFilter = '__all';

          function appendLog(msg){
            try{
              const now = new Date().toLocaleTimeString();
              if(!logsDiv) return;
              const el = document.createElement('div');
              el.textContent = '[' + now + '] ' + msg;
              logsDiv.appendChild(el);
              logsDiv.scrollTop = logsDiv.scrollHeight;
            }catch(_){ }
          }
          function setStatusText(s){ const st = document.getElementById('status'); if(st) st.textContent = 'Source: ' + s; }

          document.getElementById('refresh').addEventListener('click', () => { vscode.postMessage({type:'refreshViewer'}); appendLog('Requested refresh'); });
          document.getElementById('connect').addEventListener('click', () => { vscode.postMessage({type:'connectLocal'}); });
          document.getElementById('disconnect').addEventListener('click', () => { vscode.postMessage({type:'disconnectLocal'}); });
          document.getElementById('toggleLogs').addEventListener('click', ()=>{ if(!logsDiv) return; logsDiv.style.display = logsDiv.style.display === 'none' ? 'block' : 'none'; });
          try {
            const si = document.getElementById('search');
            const cf = document.getElementById('colFilter');
            const rl = document.getElementById('rowLimit');
            if (si) si.addEventListener('input', (e) => { try { currentSearch = e.target.value || ''; renderTableFromRows(currentRows); } catch(_){} });
            if (cf) cf.addEventListener('change', (e) => { try { currentColFilter = (e.target.value||'__all'); renderTableFromRows(currentRows); } catch(_){} });
            if (rl) rl.addEventListener('change', (e) => { try { currentLimit = Number(e.target.value||'200'); appendLog('Row limit set to ' + (currentLimit===0 ? 'All' : currentLimit)); } catch(_){} });
          } catch(_) {}

          function renderTables(tables) {
            tablesList.innerHTML = '';
            if (!tables || tables.length === 0) {
              tablesList.innerHTML = '<li style="padding:12px;color:#888">No tables</li>';
              return;
            }
            // sort alphabetically
            const sorted = (tables || []).slice().sort((a,b) => a.localeCompare(b));
            for (const t of sorted) {
              const li = document.createElement('li');
              li.textContent = t;
              li.dataset.table = t;
              li.addEventListener('click', () => {
                // highlight
                Array.from(tablesList.querySelectorAll('li')).forEach(n => n.classList.remove('selected'));
                li.classList.add('selected');
                selectedTable = t;
                tableTitle.textContent = t;
                tableArea.innerHTML = '<em>Loading rows...</em>';
                // request rows and set a timeout to avoid indefinite loading
                try { if (requestTimeout) clearTimeout(requestTimeout); } catch(_) {}
                // If sql.js DB is loaded in the webview, query locally
                if (window.sqlDb) {
                  try {
                    appendLog('Querying local DB for ' + t);
                    const limitClause = (currentLimit && currentLimit > 0) ? (' LIMIT ' + currentLimit) : '';
                    const res = window.sqlDb.exec('SELECT * FROM "' + t + '"' + limitClause + ';');
                    const rows = [];
                    if (res && res.length > 0) {
                      const cols = res[0].columns;
                      for (const vals of res[0].values) {
                        const obj = {};
                        for (let i = 0; i < cols.length; i++) obj[cols[i]] = vals[i];
                        rows.push(obj);
                      }
                    }
                    renderRows(rows);
                    appendLog('Local query returned ' + rows.length + ' rows');
                  } catch (e) {
                    appendLog('Local query error: ' + e);
                    tableArea.innerHTML = '<em>Error: ' + String(e) + '</em>';
                  }
                } else {
                  vscode.postMessage({ type: 'selectTable', table: t, limit: currentLimit });
                  requestTimeout = setTimeout(() => {
                    if (selectedTable === t) tableArea.innerHTML = '<em>No rows received</em>';
                  }, 1500);
                }
              });
              tablesList.appendChild(li);
            }
          }

          function applyFilterAndSort(rows) {
            let filtered = rows || [];
            if (currentSearch && currentSearch.trim() !== '') {
              const q = currentSearch.toLowerCase();
              if (currentColFilter && currentColFilter !== '__all') {
                filtered = filtered.filter(r => {
                  const v = r[currentColFilter];
                  return v != null && String(v).toLowerCase().indexOf(q) !== -1;
                });
              } else {
                filtered = filtered.filter(r => {
                  return Object.keys(r).some(k => {
                    const v = r[k];
                    return v != null && String(v).toLowerCase().indexOf(q) !== -1;
                  });
                });
              }
            }
            if (currentSort.col) {
              filtered = filtered.slice().sort((a,b) => {
                const va = a[currentSort.col];
                const vb = b[currentSort.col];
                if (va == null && vb == null) return 0;
                if (va == null) return -1 * currentSort.dir;
                if (vb == null) return 1 * currentSort.dir;
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * currentSort.dir;
                return String(va).localeCompare(String(vb)) * currentSort.dir;
              });
            }
            return filtered;
          }

          function renderTableFromRows(rows) {
            const toRender = applyFilterAndSort(rows);
            if (!toRender || toRender.length === 0) {
              tableTitle.textContent = (selectedTable ? selectedTable : 'No table selected') + ' — 0 rows';
              tableArea.innerHTML = '<em>No rows</em>';
              return;
            }
            const cols = Object.keys(toRender[0]);
            // populate column filter select
            try {
              const cf = document.getElementById('colFilter');
              if (cf) {
                cf.innerHTML = '';
                const optAll = document.createElement('option'); optAll.value = '__all'; optAll.textContent = 'All columns'; cf.appendChild(optAll);
                for (const c of cols) {
                  const o = document.createElement('option'); o.value = c; o.textContent = c; cf.appendChild(o);
                }
                // restore previous selection if still present
                try { if (currentColFilter) cf.value = currentColFilter; } catch(_) {}
              }
            } catch(_) {}
            const tbl = document.createElement('table');
            const thead = document.createElement('thead');
            const trh = document.createElement('tr');
            trh.innerHTML = cols.map(function(c){ return '<th data-col="' + c + '">' + c + '</th>'; }).join('');
            thead.appendChild(trh);
            tbl.appendChild(thead);
            const tbody = document.createElement('tbody');
            for (const r of toRender) {
              const tr = document.createElement('tr');
              tr.innerHTML = cols.map(function(c){ return '<td>' + (r[c]==null ? '' : String(r[c])) + '</td>'; }).join('');
              tbody.appendChild(tr);
            }
            tbl.appendChild(tbody);
            tableArea.innerHTML = '';
            tableArea.appendChild(tbl);
            // show count in title
            try { tableTitle.textContent = (selectedTable ? selectedTable : 'Table') + ' — ' + toRender.length + ' rows'; } catch(_) {}
            Array.from(thead.querySelectorAll('th')).forEach(th => {
              th.style.cursor = 'pointer';
              th.addEventListener('click', () => {
                const col = th.getAttribute('data-col');
                if (currentSort.col === col) currentSort.dir = -currentSort.dir; else { currentSort.col = col; currentSort.dir = 1; }
                renderTableFromRows(currentRows);
              });
            });
          }

          function renderRows(rows) {
            currentRows = rows || [];
            renderTableFromRows(currentRows);
          }

          window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'status') {
              setStatusText(msg.source || 'Unknown');
            }
            if (msg.type === 'tables') {
              renderTables(msg.tables || []);
            }
            if (msg.type === 'tableData') {
              try {
                if (requestTimeout) { clearTimeout(requestTimeout); requestTimeout = null; }
              } catch(_) {}
              // Only render if it matches the selected table (or if none selected)
              if (!msg.table || !selectedTable || msg.table === selectedTable) {
                if (msg.error) {
                  tableArea.innerHTML = '<em>Error: ' + String(msg.error) + '</em>';
                  appendLog('Error for table ' + (msg.table||'<unknown>') + ': ' + String(msg.error));
                } else {
                  renderRows(msg.rows || []);
                  appendLog('Received ' + ((msg.rows||[]).length) + ' row(s) for ' + (msg.table||'<unknown>'));
                }
              }
            }
            if (msg.type === 'dbBytes') {
              try {
                appendLog('Received DB bytes: ' + (msg.name || '<unknown>'));
                // store pending bytes and try to initialize sql.js when ready
                window.__pendingDbBytes = { name: msg.name || '<unknown>', b64: msg.data || '' };
                function base64ToUint8Array(b64str) {
                  try {
                    const binary = atob(b64str);
                    const len = binary.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
                    return bytes;
                  } catch (e) { appendLog('base64->u8 error: ' + e); return null; }
                }
                function tryLoadPending() {
                  const pending = window.__pendingDbBytes;
                  if (!pending || !pending.b64) return;
                  if (typeof initSqlJs !== 'function') {
                    appendLog('sql.js not ready yet, retrying in 800ms');
                    setTimeout(tryLoadPending, 800);
                    return;
                  }
                  appendLog('Initializing sql.js (WASM)...');
                  initSqlJs({ locateFile: file => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.wasm' })
                    .then(SQL => {
                      try {
                        const u8 = base64ToUint8Array(pending.b64);
                        if (!u8) { appendLog('Invalid DB bytes'); return; }
                        const db = new SQL.Database(u8);
                        window.sqlDb = db;
                        appendLog('DB loaded into sql.js');
                        // list tables
                        try {
                          const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
                          const names = [];
                          if (res && res.length > 0) {
                            for (const row of res[0].values) names.push(row[0]);
                          }
                          renderTables(names);
                          appendLog('Found ' + names.length + ' table(s) in DB');
                        } catch (e) { appendLog('Failed to list tables: ' + e); }
                        // clear pending
                        window.__pendingDbBytes = null;
                      } catch (e) { appendLog('sql.js DB init error: ' + e); }
                    })
                    .catch(e => { appendLog('initSqlJs failed: ' + e); setTimeout(tryLoadPending, 2000); });
                }
                // kick off attempt to load (will retry until initSqlJs is present)
                tryLoadPending();
              } catch (e) { appendLog('dbBytes handler error: ' + e); }
            }
            if (msg.type === 'log') {
              appendLog(msg.message || JSON.stringify(msg));
            }
          });
        </script>
      </body>
      </html>`;

      // message handling from webview
      // Handle messages from the webview (select table, refresh, save, delete)
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "selectTable") {
          const table = msg.table;
          if (!table) return;
          activeViewerTable = table;
          panel.title = `Drift DB Viewer — ${activeViewerTable}`;
          // request rows for the selected table from connected apps
          try {
            panel.webview.postMessage({
              type: "log",
              message: `Requesting rows for ${activeViewerTable}`,
            });
            const limit = msg.limit || 200;
            lastRequestedLimit = limit;
            await vscode.commands.executeCommand(
              "drift-studio.requestTableData",
              activeViewerTable,
              { limit },
            );
            vscode.window.showInformationMessage(
              `Requested rows for table ${activeViewerTable}`,
            );
          } catch (e) {
            console.error("requestTableData error", e);
          }
          return;
        }
        if (msg.type === "refreshViewer") {
          if (!activeViewerTable) {
            vscode.window.showErrorMessage(
              "No table selected to refresh. Select a table first.",
            );
            return;
          }
          const limit = lastRequestedLimit || 200;
          panel.webview.postMessage({
            type: "log",
            message: `Requesting rows for ${activeViewerTable} (refresh)`,
          });
          await vscode.commands.executeCommand(
            "drift-studio.requestTableData",
            activeViewerTable,
            { limit },
          );
          return;
        }
        if (msg.type === "saveViewer") {
          vscode.window.showInformationMessage(
            "Save requested (not implemented)",
          );
        }
        if (msg.type === "deleteViewer") {
          vscode.window.showInformationMessage(
            "Delete requested (not implemented)",
          );
        }
        if (msg.type === "connectLocal") {
          try {
            if (lastDbFilePath) {
              localConnected = true;
              panel.webview.postMessage({
                type: "log",
                message: `Connected to local DB: ${lastDbFilePath}`,
              });
              panel.webview.postMessage({ type: "status", source: "Local" });
              // If we already know the last DB path, send its bytes to the webview
              try {
                const buf = fs.readFileSync(lastDbFilePath);
                const b64 = buf.toString("base64");
                panel.webview.postMessage({
                  type: "dbBytes",
                  name: path.basename(lastDbFilePath),
                  data: b64,
                });
                lastDbBytesSentAt = Date.now();
                panel.webview.postMessage({
                  type: "log",
                  message: `Sent existing DB bytes to webview (${lastDbFilePath})`,
                });
              } catch (e) {
                panel.webview.postMessage({
                  type: "log",
                  message: `Failed to send existing DB bytes: ${String(e)}`,
                });
              }
            } else {
              const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: "Select DB file",
              });
              if (uris && uris.length > 0) {
                lastDbFilePath = uris[0].fsPath;
                localConnected = true;
                panel.webview.postMessage({
                  type: "log",
                  message: `Selected DB file: ${lastDbFilePath}`,
                });
                panel.webview.postMessage({ type: "status", source: "Local" });
                try {
                  const buf = fs.readFileSync(lastDbFilePath);
                  const b64 = buf.toString("base64");
                  panel.webview.postMessage({
                    type: "dbBytes",
                    name: path.basename(lastDbFilePath),
                    data: b64,
                  });
                  lastDbBytesSentAt = Date.now();
                  panel.webview.postMessage({
                    type: "log",
                    message: `Sent selected DB bytes to webview (${lastDbFilePath})`,
                  });
                } catch (e) {
                  console.error("connectLocal: failed to send DB bytes", e);
                }
              } else {
                panel.webview.postMessage({
                  type: "log",
                  message: "No DB file selected",
                });
              }
            }
          } catch (e) {
            console.error("connectLocal error", e);
            panel.webview.postMessage({
              type: "log",
              message: `connectLocal error: ${String(e)}`,
            });
          }
        }
        if (msg.type === "disconnectLocal") {
          localConnected = false;
          panel.webview.postMessage({
            type: "log",
            message: "Disconnected local DB",
          });
          try {
            panel.webview.postMessage({ type: "status", source: "Classes" });
          } catch (_) {}
        }
      });

      // track active panel
      activeDbViewer = panel;
      // If we already have a last DB file path (e.g., opened via notification), send its bytes to the new webview
      try {
        if (lastDbFilePath) {
          try {
            const buf = fs.readFileSync(lastDbFilePath);
            const b64 = buf.toString("base64");
            panel.webview.postMessage({
              type: "dbBytes",
              name: path.basename(lastDbFilePath),
              data: b64,
            });
            lastDbBytesSentAt = Date.now();
            panel.webview.postMessage({
              type: "log",
              message: `Sent existing DB bytes to webview (${lastDbFilePath})`,
            });
          } catch (e) {
            panel.webview.postMessage({
              type: "log",
              message: `Failed to send existing DB bytes: ${String(e)}`,
            });
          }
        }
      } catch (_) {}
      // Send current tables (if any) to the viewer so it can render left pane
      try {
        const tables = (treeProvider as any).getTables
          ? (treeProvider as any).getTables()
          : [];
        panel.webview.postMessage({ type: "tables", tables });
      } catch (_) {}
      // allow opening viewer with a specific table (pass { tableName: 'users' })
      try {
        const tableArg = args && (args.tableName || args.table || args);
        if (tableArg && typeof tableArg === "string") {
          activeViewerTable = String(tableArg);
          panel.webview.postMessage({
            type: "status",
            source: "Device",
            table: activeViewerTable,
          });
          panel.title = `Drift DB Viewer — ${activeViewerTable}`;
        }
      } catch (_) {}
      panel.onDidDispose(() => {
        if (activeDbViewer === panel) activeDbViewer = null;
        activeViewerTable = null;
      });
    },
  );
  context.subscriptions.push(openDbViewerCommand);

  // Command to open DB viewer for a specific table (used by tree context menu)
  const openDbViewerForTable = vscode.commands.registerCommand(
    "drift-studio.openDbViewerForTable",
    async (args: any) => {
      try {
        const tableName = args && (args.tableName || args.label || args);
        await vscode.commands.executeCommand("drift-studio.openDbViewer", {
          tableName,
        });
      } catch (e) {
        console.error("openDbViewerForTable error", e);
      }
    },
  );
  context.subscriptions.push(openDbViewerForTable);

  // Command invoked by devServer when table rows arrive
  const tableDataCommand = vscode.commands.registerCommand(
    "drift-studio.tableData",
    (table: string, rowsOrPayload: any) => {
      try {
        if (activeDbViewer) {
          activeDbViewer.webview.postMessage({
            type: "status",
            source: "Device",
          });
          // rowsOrPayload may be an array or an object { rows, error }
          let rows = [] as any[];
          let error: string | undefined = undefined;
          if (Array.isArray(rowsOrPayload)) {
            rows = rowsOrPayload;
          } else if (rowsOrPayload && typeof rowsOrPayload === "object") {
            rows = rowsOrPayload.rows || [];
            error = rowsOrPayload.error;
          }

          // If no clients are connected, attempt a fallback strategy:
          // 1) If we have a last saved DB file and sqlite3 available, query it.
          // 2) If sqlite3 is missing, inform the webview with guidance to install it.
          // 3) If no saved DB path exists, send a clear error.
          const requestedLimit =
            rowsOrPayload &&
            typeof rowsOrPayload === "object" &&
            rowsOrPayload.limit
              ? Number(rowsOrPayload.limit)
              : 200;
          if (error === "no_clients" || error === "no_db_path") {
            if (lastDbFilePath && sqlite3) {
              try {
                const dbPath = lastDbFilePath;
                const db = new sqlite3.Database(
                  dbPath,
                  sqlite3.OPEN_READONLY,
                  (openErr: any) => {
                    if (openErr) {
                      activeDbViewer?.webview.postMessage({
                        type: "tableData",
                        table,
                        rows: [],
                        error: `local_open_failed: ${String(openErr)}`,
                      });
                      activeDbViewer?.webview.postMessage({
                        type: "log",
                        message: `local_open_failed: ${String(openErr)}`,
                      });
                      return;
                    }
                    const limit =
                      requestedLimit && requestedLimit > 0
                        ? requestedLimit
                        : undefined;
                    const limitClause = limit ? ` LIMIT ${limit}` : "";
                    const sql = `SELECT * FROM "${table}"${limitClause}`;
                    db.all(sql, (err: any, rowsRes: any[]) => {
                      if (err) {
                        activeDbViewer?.webview.postMessage({
                          type: "tableData",
                          table,
                          rows: [],
                          error: `local_query_failed: ${String(err)}`,
                        });
                        activeDbViewer?.webview.postMessage({
                          type: "log",
                          message: `local_query_failed: ${String(err)}`,
                        });
                      } else {
                        activeDbViewer?.webview.postMessage({
                          type: "tableData",
                          table,
                          rows: rowsRes || [],
                        });
                        activeDbViewer?.webview.postMessage({
                          type: "log",
                          message: `Queried local DB ${dbPath} table ${table} returned ${(rowsRes || []).length} row(s)`,
                        });
                        try {
                          setSourceLabel("Device (local)");
                        } catch (_) {}
                      }
                      try {
                        db.close();
                      } catch (_) {}
                    });
                  },
                );
              } catch (localErr) {
                activeDbViewer.webview.postMessage({
                  type: "tableData",
                  table,
                  rows: [],
                  error: `local_query_failed: ${String(localErr)}`,
                });
                activeDbViewer?.webview.postMessage({
                  type: "log",
                  message: `local_query_failed: ${String(localErr)}`,
                });
              }
            } else if (lastDbFilePath && !sqlite3) {
              // sqlite3 not available in the extension runtime
              // If we recently sent DB bytes to the webview, prefer waiting for the
              // webview (sql.js) to perform the local query instead of emitting an
              // immediate error. Give webview a short window to load the DB.
              const now = Date.now();
              if (lastDbBytesSentAt && now - lastDbBytesSentAt < 15000) {
                activeDbViewer?.webview.postMessage({
                  type: "log",
                  message: `Awaiting webview local query (db bytes sent ${(now - lastDbBytesSentAt) / 1000}s ago)`,
                });
              } else {
                activeDbViewer?.webview.postMessage({
                  type: "tableData",
                  table,
                  rows: [],
                  error: `no_clients_no_sqlite: sqlite3 not available in extension. Install sqlite3 and rebuild the extension (lastDb: ${lastDbFilePath})`,
                });
                activeDbViewer?.webview.postMessage({
                  type: "log",
                  message: `no_clients_no_sqlite: sqlite3 not available (lastDb: ${lastDbFilePath})`,
                });
              }
            } else {
              // no saved DB path; try to locate a recent temp DB file created by the dev server
              try {
                const tmp = os.tmpdir();
                const entries = fs.readdirSync(tmp) || [];
                const candidates = entries
                  .filter((f: string) => f.startsWith("drift-"))
                  .map((f: string) => ({
                    file: path.join(tmp, f),
                    mtime: fs.statSync(path.join(tmp, f)).mtime.getTime(),
                  }))
                  .sort((a: any, b: any) => b.mtime - a.mtime);
                if (candidates.length > 0) {
                  lastDbFilePath = candidates[0].file;
                  activeDbViewer?.webview.postMessage({
                    type: "log",
                    message: `Found temp DB file: ${lastDbFilePath}`,
                  });
                  try {
                    const buf = fs.readFileSync(lastDbFilePath);
                    const b64 = buf.toString("base64");
                    activeDbViewer?.webview.postMessage({
                      type: "dbBytes",
                      name: path.basename(lastDbFilePath),
                      data: b64,
                    });
                    lastDbBytesSentAt = Date.now();
                    activeDbViewer?.webview.postMessage({
                      type: "log",
                      message: `Sent fallback DB bytes to webview (${lastDbFilePath})`,
                    });
                  } catch (e) {
                    console.error("failed to send fallback db bytes", e);
                  }
                }
              } catch (_) {}

              if (lastDbFilePath && sqlite3) {
                try {
                  const dbPath = lastDbFilePath;
                  const db = new sqlite3.Database(
                    dbPath,
                    sqlite3.OPEN_READONLY,
                    (openErr: any) => {
                      if (openErr) {
                        activeDbViewer?.webview.postMessage({
                          type: "tableData",
                          table,
                          rows: [],
                          error: `local_open_failed: ${String(openErr)}`,
                        });
                        activeDbViewer?.webview.postMessage({
                          type: "log",
                          message: `local_open_failed: ${String(openErr)}`,
                        });
                        return;
                      }
                      const limit = 200;
                      const sql = `SELECT * FROM "${table}" LIMIT ${limit}`;
                      db.all(sql, (err: any, rowsRes: any[]) => {
                        if (err) {
                          activeDbViewer?.webview.postMessage({
                            type: "tableData",
                            table,
                            rows: [],
                            error: `local_query_failed: ${String(err)}`,
                          });
                          activeDbViewer?.webview.postMessage({
                            type: "log",
                            message: `local_query_failed: ${String(err)}`,
                          });
                        } else {
                          activeDbViewer?.webview.postMessage({
                            type: "tableData",
                            table,
                            rows: rowsRes || [],
                          });
                          activeDbViewer?.webview.postMessage({
                            type: "log",
                            message: `Queried fallback DB ${dbPath} table ${table} returned ${(rowsRes || []).length} row(s)`,
                          });
                          try {
                            setSourceLabel("Device (local)");
                          } catch (_) {}
                        }
                        try {
                          db.close();
                        } catch (_) {}
                      });
                    },
                  );
                } catch (localErr) {
                  activeDbViewer.webview.postMessage({
                    type: "tableData",
                    table,
                    rows: [],
                    error: `local_query_failed: ${String(localErr)}`,
                  });
                  activeDbViewer?.webview.postMessage({
                    type: "log",
                    message: `local_query_failed: ${String(localErr)}`,
                  });
                }
              } else if (lastDbFilePath && !sqlite3) {
                const now = Date.now();
                if (lastDbBytesSentAt && now - lastDbBytesSentAt < 15000) {
                  activeDbViewer?.webview.postMessage({
                    type: "log",
                    message: `Awaiting webview local query (db bytes sent ${(now - lastDbBytesSentAt) / 1000}s ago)`,
                  });
                } else {
                  activeDbViewer?.webview.postMessage({
                    type: "tableData",
                    table,
                    rows: [],
                    error: `no_clients_no_sqlite: sqlite3 not available in extension. Install sqlite3 and rebuild the extension (lastDb: ${lastDbFilePath})`,
                  });
                  activeDbViewer?.webview.postMessage({
                    type: "log",
                    message: `no_clients_no_sqlite: sqlite3 not available (lastDb: ${lastDbFilePath})`,
                  });
                }
              } else {
                activeDbViewer?.webview.postMessage({
                  type: "tableData",
                  table,
                  rows: [],
                  error: `no_clients_no_dbfile: no saved DB file available. Ensure the app sends the DB or keep the client connected.`,
                });
                activeDbViewer?.webview.postMessage({
                  type: "log",
                  message: `no_clients_no_dbfile: no saved DB file available`,
                });
              }
            }
          } else {
            activeDbViewer.webview.postMessage({
              type: "tableData",
              table,
              rows,
              error,
            });
            activeDbViewer?.webview.postMessage({
              type: "log",
              message: `Received ${rows.length} row(s) from device for table ${table}`,
            });
            try {
              setSourceLabel("Device");
            } catch (_) {}
          }
        } else {
          vscode.window.showInformationMessage(
            `Received ${rowsOrPayload?.rows ? rowsOrPayload.rows.length : (rowsOrPayload?.length ?? 0)} rows for table ${table} (no viewer open)`,
          );
        }
      } catch (e) {
        console.error("tableData handler error", e);
      }
    },
  );
  context.subscriptions.push(tableDataCommand);

  // Atualiza a árvore ao ativar
  findDriftTables().then((tables) => {
    treeProvider.setTables(tables);
    try {
      setSourceLabel("Classes");
    } catch (_) {}
  });

  // Comando para atualizar manualmente
  const refreshCommand = vscode.commands.registerCommand(
    "drift-studio.refreshTables",
    async () => {
      const tables = await findDriftTables();
      treeProvider.setTables(tables);
      treeProvider.clearColumnsCache();
      vscode.window.showInformationMessage("Drift tables updated!");
    },
  );
  context.subscriptions.push(refreshCommand);

  // Comando para exportar toda a estrutura do banco em JSON
  const exportAllCommand = vscode.commands.registerCommand(
    "drift-studio.exportAll",
    async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting DB structure...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Collecting tables..." });
            const tables = (await findDriftTables())
              .slice()
              .sort((a, b) => a.localeCompare(b));
            const result: Record<string, { name: string; type: string }[]> = {};
            for (const [i, t] of tables.entries()) {
              progress.report({
                message: `Collecting columns: ${t} (${i + 1}/${tables.length})`,
              });
              const cols = ((await findDriftTableColumns(t)) || [])
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
              result[t] = cols;
            }
            progress.report({ message: "Preparing JSON file..." });
            const json = JSON.stringify(result, null, 2);
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(`drift-structure.json`),
              filters: { JSON: ["json"] },
            });
            if (!uri) {
              return;
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(json, "utf8"));
            vscode.window.showInformationMessage(
              `Exported DB structure to ${uri.fsPath}`,
            );
          },
        );
      } catch (err) {
        vscode.window.showErrorMessage(String(err));
      }
    },
  );
  context.subscriptions.push(exportAllCommand);

  // removido: comandos para criar tabela/coluna e menus de contexto (clique direito)

  vscode.window.showInformationMessage("🚀 Drift Studio ativo");
}

export function deactivate() {}
