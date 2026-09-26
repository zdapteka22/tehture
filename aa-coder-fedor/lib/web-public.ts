import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const req = createRequire(fileURLToPath(import.meta.url));
const webFiles = req("./web-files.cjs") as {
  fetchPublicPage: (url: string) => Promise<string>;
};

export async function fetchPublicPage(url: string): Promise<string> {
  return webFiles.fetchPublicPage(url);
}
