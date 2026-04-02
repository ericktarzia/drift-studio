import * as vscode from "vscode";
import { DriftTreeProvider } from "./driftTreeProvider";
import { findDriftTables } from "./utils";

export function activate(context: vscode.ExtensionContext) {
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
