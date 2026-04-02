import * as vscode from "vscode";

type DriftNode = {
  label: string;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  children?: DriftNode[];
};

const MOCK_DATA: DriftNode[] = [
  {
    label: "tables",
    collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
    children: [{ label: "users" }, { label: "orders" }, { label: "products" }],
  },
];

export class DriftTreeProvider implements vscode.TreeDataProvider<DriftNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    DriftNode | undefined | void
  > = new vscode.EventEmitter<DriftNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<DriftNode | undefined | void> =
    this._onDidChangeTreeData.event;

  getTreeItem(element: DriftNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None,
    );
    return item;
  }

  getChildren(element?: DriftNode): Thenable<DriftNode[]> {
    if (!element) {
      return Promise.resolve(MOCK_DATA);
    }
    return Promise.resolve(element.children ?? []);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}
