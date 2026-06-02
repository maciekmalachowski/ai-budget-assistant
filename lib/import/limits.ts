/**
 * Max accepted CSV upload size. Kept under Vercel's ~4.5 MB serverless request-body
 * limit so the cap is meaningful (a bank statement CSV is far smaller in practice).
 */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/** True when an upload of `bytes` exceeds the import cap. */
export function importTooLarge(bytes: number): boolean {
  return bytes > MAX_IMPORT_BYTES;
}
