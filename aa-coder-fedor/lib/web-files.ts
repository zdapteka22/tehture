import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const req = createRequire(fileURLToPath(import.meta.url));
const webFiles = req("./web-files.cjs") as {
  webSearch: (query: string, maxResults?: number) => Promise<string>;
  downloadFile: (opts: Record<string, unknown>) => Promise<string>;
  inspectApk: (path: string) => string;
  inspectZip: (path: string) => string;
  looksLikeDownloadWork: (text: string) => boolean;
};

export async function webSearch(query: string, maxResults = 10): Promise<string> {
  return webFiles.webSearch(query, maxResults);
}

export async function downloadFile(opts: Record<string, unknown>): Promise<string> {
  return webFiles.downloadFile(opts);
}

export function inspectApk(filePath: string): string {
  return webFiles.inspectApk(filePath);
}

export function inspectZip(filePath: string): string {
  return webFiles.inspectZip(filePath);
}

export function looksLikeDownloadWork(text: string): boolean {
  return webFiles.looksLikeDownloadWork(text);
}
