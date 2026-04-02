import * as vscode from "vscode";

export async function findDriftTables(): Promise<string[]> {
  const dartFiles = await vscode.workspace.findFiles(
    "**/*.dart",
    "**/node_modules/**",
  );
  const tables: string[] = [];
  for (const fileUri of dartFiles) {
    try {
      const fileBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(fileBytes).toString("utf8");
      const tableMatches = [
        ...content.matchAll(/class\s+(\w+)\s+extends\s+Table/g),
      ];
      for (const tableMatch of tableMatches) {
        tables.push(tableMatch[1]);
      }
    } catch (e) {}
  }
  return tables;
}

export async function findDriftTableColumns(
  tableName: string,
): Promise<{ name: string; type: string }[]> {
  const dartFiles = await vscode.workspace.findFiles(
    "**/*.dart",
    "**/node_modules/**",
  );
  for (const fileUri of dartFiles) {
    try {
      const fileBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(fileBytes).toString("utf8");
      const classRegex = new RegExp(
        `class\\s+${tableName}\\s+extends\\s+Table\\s*{([\\s\\S]*?)}`,
      );
      const classBodyMatch = content.match(classRegex);
      if (classBodyMatch) {
        const columns: { name: string; type: string }[] = [];
        const arrowColumnRegex =
          /(?:@\w+\s*)*\n\s*(\w+)\s*=>\s*([A-Za-z]+Column)\s*\(/g;
        let match;
        while ((match = arrowColumnRegex.exec(classBodyMatch[1])) !== null) {
          columns.push({ name: match[1], type: match[2] });
        }
        const getterColumnRegex = /([A-Za-z]+Column)\s+get\s+(\w+)/g;
        while ((match = getterColumnRegex.exec(classBodyMatch[1])) !== null) {
          columns.push({ name: match[2], type: match[1] });
        }
        return columns;
      }
    } catch (e) {}
  }
  return [];
}
