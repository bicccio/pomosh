import { writeFile, appendFile } from 'fs/promises';

export async function safeWrite(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, 'utf-8');
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`⚠ Failed to write ${path}: ${msg}\n`);
    return false;
  }
}

export async function safeAppend(path: string, content: string): Promise<boolean> {
  try {
    await appendFile(path, content);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`⚠ Failed to append to ${path}: ${msg}\n`);
    return false;
  }
}
