import { readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const categories = ["menu", "ambient", "combat", "dialogue", "interior"];
const supportedExtensions = new Set([".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"]);
const musicRoot = resolve(process.cwd(), "public", "music");

async function findTracks(directory) {
  const tracks = [];
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return tracks; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tracks.push(...await findTracks(path));
    else if (entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase())) tracks.push(path);
  }
  return tracks;
}

const tracks = Object.fromEntries(await Promise.all(categories.map(async (category) => {
  const files = await findTracks(join(musicRoot, category));
  const urls = files.sort().map((file) => "/music/" + relative(musicRoot, file).split(sep).map(encodeURIComponent).join("/"));
  return [category, urls];
})));

await writeFile(join(musicRoot, "manifest.json"), JSON.stringify({ tracks }, null, 2) + "\n", "utf8");
const total = Object.values(tracks).reduce((sum, list) => sum + list.length, 0);
console.log(`Music manifest: ${total} track${total === 1 ? "" : "s"}`);
