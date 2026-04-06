import * as vscode from "vscode";
import { findDriftTableColumns } from "./utils";

export class DriftTreeProvider implements vscode.TreeDataProvider<any> {
  private _onDidChangeTreeData: vscode.EventEmitter<any | undefined | void> =
    new vscode.EventEmitter<any | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<any | undefined | void> =
    this._onDidChangeTreeData.event;

  private _tables: string[] = [];
  private _loadingTables = true;
  private _columnsCache: {
    [table: string]: { name: string; type: string }[] | undefined;
  } = {};

  public clearColumnsCache() {
    this._columnsCache = {};
  }
  setTables(tables: string[]) {
    this._tables = tables;
    this._loadingTables = false;
    this.refresh();
  }
  getTables(): string[] {
    return this._tables.slice();
  }
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
  async getChildren(element?: any): Promise<any[]> {
    if (!element) {
      if (this._loadingTables) {
        return [
          {
            label: "Loading tables...",
            collapsibleState: vscode.TreeItemCollapsibleState.None,
          },
        ];
      }
      return [
        {
          label: `tables${this._tables ? ` (${this._tables.length})` : ""}`,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
          command: {
            command: "drift-studio.exportAll",
            title: "Export DB Structure",
          },
          children: this._tables
            .slice()
            .sort((a, b) => a.localeCompare(b))
            .map((table) => ({
              label: table,
              collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
              contextValue: "driftTableNode",
              command: {
                command: "drift-studio.openTableWebview",
                title: "Open table",
                arguments: [{ tableName: table }],
              },
            })),
          contextValue: "tablesRootNode",
        },
      ];
    }
    if (
      element &&
      typeof element.label === "string" &&
      this._tables.includes(element.label)
    ) {
      if (this._columnsCache[element.label]) {
        const cols = (this._columnsCache[element.label] || [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        if (cols.length === 0) {
          return [
            {
              label: "No columns found",
              collapsibleState: vscode.TreeItemCollapsibleState.None,
            },
          ];
        }
        return cols.map((col) => ({ label: `${col.name} (${col.type})` }));
      }
      setTimeout(() => this.refresh(), 1000);
      findDriftTableColumns(element.label).then(
        (cols: { name: string; type: string }[]) => {
          this._columnsCache[element.label] = cols;
          if (cols.length === 0) {
            vscode.window.showWarningMessage(
              `No columns found for table '${element.label}'. Check your code pattern or the regex.`,
            );
          }
          this.refresh();
        },
      );
      return [
        {
          label: "Loading...",
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        },
      ];
    }
    return element.children ? element.children : [];
  }
  getTreeItem(element: any): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None,
    );
    if (element.command) {
      item.command = element.command;
    }
    if (element.contextValue) {
      item.contextValue = element.contextValue;
      if (element.contextValue === "tablesRootNode") {
        item.iconPath = new vscode.ThemeIcon("cloud-upload");
      }
    }
    return item;
  }
}
