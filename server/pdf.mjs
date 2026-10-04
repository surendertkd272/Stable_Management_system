// HTML -> PDF with headless Chrome on the site server (the report's one-tap
// "Download PDF"). The report sets its own A4 pages (@page margin 0, exact
// colours), so Chrome prints it edge to edge with no header or footer.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROMES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium",
  "/usr/bin/chromium-browser", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"];

export const chromePath = () => process.env.EQUICARE_CHROME || CHROMES.find(existsSync) || null;

/** Resolves to the PDF bytes, or throws with a reason a person can act on. */
export async function htmlToPdf(html, { timeoutMs = 120000 } = {}) {
  const chrome = chromePath();
  if (!chrome) throw new Error("PDF needs Google Chrome on the site server — open the report and use Print → Save as PDF");
  const dir = mkdtempSync(join(tmpdir(), "eqc-pdf-"));
  const src = join(dir, "report.html"), out = join(dir, "report.pdf");
  writeFileSync(src, html);
  // Headless Chrome on macOS writes the PDF and then does not always exit:
  // wait for the file to stop growing, then close it.
  const ch = spawn(chrome, ["--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "profile")}`, "--no-pdf-header-footer",
    `--print-to-pdf=${out}`, `file://${src}`], { stdio: "ignore", detached: true });
  let last = -1, done = false;
  const t0 = Date.now();
  while (!done && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 500));
    const size = existsSync(out) ? statSync(out).size : -1;
    done = size > 0 && size === last;
    last = size;
  }
  try { process.kill(-ch.pid); } catch { /* already gone */ }
  try {
    if (!done) throw new Error("Chrome did not produce the PDF in time — open the report and use Print → Save as PDF");
    return readFileSync(out);
  } finally {
    setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } }, 2000);
  }
}
