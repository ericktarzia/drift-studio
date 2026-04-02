import * as vscode from "vscode";
import { DriftTreeProvider } from "./driftTreeProvider";
import { findDriftTables, findDriftTableColumns } from "./utils";

export function activate(context: vscode.ExtensionContext) {
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
      // Cria webview
      const panel = vscode.window.createWebviewPanel(
        "driftStudioTableWebview",
        `Drift Table: ${tableName}`,
        vscode.ViewColumn.Active,
        { enableScripts: true },
      );
      panel.webview.html = getTableWebviewHtml(tableName, columns);
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

  // Atualiza a árvore ao ativar
  findDriftTables().then((tables) => treeProvider.setTables(tables));

  // Comando para atualizar manualmente
  const refreshCommand = vscode.commands.registerCommand(
    "drift-studio.refreshTables",
    async () => {
      const tables = await findDriftTables();
      treeProvider.setTables(tables);
      treeProvider.clearColumnsCache();
      vscode.window.showInformationMessage("Tabelas Drift atualizadas!");
    },
  );
  context.subscriptions.push(refreshCommand);

  // Comando para criar nova tabela Drift
  const createTableCommand = vscode.commands.registerCommand(
    "drift-studio.createTable",
    async () => {
      const tableName = await vscode.window.showInputBox({
        prompt: "Nome da nova tabela Drift",
        placeHolder: "Ex: users",
        validateInput: (value) =>
          !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)
            ? "Nome inválido. Use apenas letras, números e _ (não pode começar com número)."
            : undefined,
      });
      if (!tableName) {
        return;
      }
      // Aqui você pode escolher o arquivo .dart para inserir a tabela
      const dartFiles = await vscode.workspace.findFiles(
        "**/*.dart",
        "**/node_modules/**",
      );
      if (dartFiles.length === 0) {
        vscode.window.showErrorMessage(
          "Nenhum arquivo .dart encontrado no projeto.",
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        dartFiles.map((uri) => ({
          label: vscode.workspace.asRelativePath(uri),
          uri,
        })),
        { placeHolder: "Selecione o arquivo .dart para criar a tabela" },
      );
      if (!picked) {
        return;
      }
      const insertCode = `\nclass ${tableName} extends Table {\n  // TODO: Adicione colunas\n}\n`;
      const fileBytes = await vscode.workspace.fs.readFile(picked.uri);
      const content = Buffer.from(fileBytes).toString("utf8");
      const edit = new vscode.WorkspaceEdit();
      edit.insert(
        picked.uri,
        new vscode.Position(content.split("\n").length, 0),
        insertCode,
      );
      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage(
        `Tabela '${tableName}' criada em ${picked.label}`,
      );
      // Atualiza árvore
      const tables = await findDriftTables();
      treeProvider.setTables(tables);
      treeProvider.clearColumnsCache();
    },
  );
  context.subscriptions.push(createTableCommand);

  vscode.window.showInformationMessage("🚀 Drift Studio ativo");
}

export function deactivate() {}
// teste release-please
