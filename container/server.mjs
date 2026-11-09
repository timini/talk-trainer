// The render server inside the container: POST /render with a .pptx body answers a zip of PNGs, one a slide
// (slide-1.png, slide-2.png and so on). LibreOffice turns the deck into a PDF and poppler the PDF into images.
// One deck at a time, as LibreOffice runs one instance per profile. GET /health answers ok.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rename, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const PORT = Number(process.env.PORT ?? 8080);
const SOFFICE = process.env.SOFFICE ?? "soffice";
// Slide images 1600 pixels wide.
const WIDTH = 1600;

let queue = Promise.resolve();

async function render(deck) {
  const dir = await mkdtemp(path.join(tmpdir(), "render-"));
  try {
    await writeFile(path.join(dir, "deck.pptx"), deck);
    await run(SOFFICE, ["--headless", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "pdf",
      "--outdir", dir, path.join(dir, "deck.pptx")], { timeout: 300000 });
    await run("pdftoppm", ["-png", "-scale-to-x", String(WIDTH), "-scale-to-y", "-1", path.join(dir, "deck.pdf"),
      path.join(dir, "slide")], { timeout: 300000 });
    // pdftoppm pads the page numbers (slide-01.png); the names going back are not padded.
    const pngs = (await readdir(dir)).filter((f) => /^slide-\d+\.png$/.test(f));
    for (const f of pngs) await rename(path.join(dir, f), path.join(dir, `slide-${Number(f.slice(6, -4))}.png`));
    await run("zip", ["-j", "-q", path.join(dir, "slides.zip"), ...pngs.map((f) => path.join(dir, `slide-${Number(f.slice(6, -4))}.png`))]);
    return await readFile(path.join(dir, "slides.zip"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (req.method !== "POST" || req.url !== "/render") { res.statusCode = 404; return res.end("not found"); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const job = queue.then(() => render(Buffer.concat(chunks)));
  queue = job.catch(() => {});
  try {
    const zip = await job;
    res.setHeader("Content-Type", "application/zip");
    res.end(zip);
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err.stderr || err.message).slice(0, 500));
  }
}).listen(PORT, () => console.log(`render server on ${PORT}`));
