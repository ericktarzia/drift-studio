import * as vscode from "vscode";

async function findDartFilesPreferLib(): Promise<vscode.Uri[]> {
  // Prefer files under `lib/` first (typical Flutter package layout),
  // but also include other dart files to be comprehensive.
  const libFiles = await vscode.workspace.findFiles(
    "**/lib/**/*.dart",
    "**/node_modules/**",
  );
  const allFiles = await vscode.workspace.findFiles(
    "**/*.dart",
    "**/node_modules/**",
  );
  if (libFiles.length === 0) return allFiles;
  // Merge with lib files first and avoid duplicates (by fsPath)
  const map = new Map<string, vscode.Uri>();
  for (const f of libFiles) map.set(f.fsPath, f);
  for (const f of allFiles) map.set(f.fsPath, f);
  return Array.from(map.values());
}

export async function findDriftTables(): Promise<string[]> {
  const dartFiles = await findDartFilesPreferLib();
  const tables = new Set<string>();
  for (const fileUri of dartFiles) {
    try {
      const fileBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(fileBytes).toString("utf8");
      const tableMatches = [
        ...content.matchAll(/class\s+([A-Za-z_]\w*)\s+extends\s+Table\b/g),
      ];
      for (const tableMatch of tableMatches) {
        tables.add(tableMatch[1]);
      }
    } catch (e) {
      // ignore unreadable files
    }
  }
  return Array.from(tables).sort((a, b) => a.localeCompare(b));
}

export async function findDriftTableColumns(
  tableName: string,
): Promise<{ name: string; type: string }[]> {
  const dartFiles = await findDartFilesPreferLib();
  const classRegex = new RegExp(
    `class\\s+${tableName}\\s+extends\\s+Table\\s*{([\\s\\S]*?)}`,
    "m",
  );
  for (const fileUri of dartFiles) {
    try {
      const fileBytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(fileBytes).toString("utf8");
      const classBodyMatch = content.match(classRegex);
      if (classBodyMatch) {
        const body = classBodyMatch[1];
        const cols: { name: string; type: string }[] = [];
        // Arrow-style column definitions (e.g. id => integer().autoIncrement() )
        const arrowColumnRegex =
          /(?:@\w+\s*)*[\r\n]\s*(\w+)\s*=>\s*([A-Za-z]+Column)\s*\(/g;
        let match;
        while ((match = arrowColumnRegex.exec(body)) !== null) {
          cols.push({ name: match[1], type: match[2] });
        }
        // Getter-style column definitions (e.g. IntColumn get id => integer())
        const getterColumnRegex = /([A-Za-z]+Column)\s+get\s+(\w+)/g;
        while ((match = getterColumnRegex.exec(body)) !== null) {
          cols.push({ name: match[2], type: match[1] });
        }
        // De-duplicate columns by name, keeping first occurrence
        const seen = new Map<string, string>();
        for (const c of cols) if (!seen.has(c.name)) seen.set(c.name, c.type);
        return Array.from(seen.entries()).map(([name, type]) => ({
          name,
          type,
        }));
      }
    } catch (e) {
      // ignore
    }
  }
  return [];
}
