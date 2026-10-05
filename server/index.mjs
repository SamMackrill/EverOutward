import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createStore, createPreviewStore } from "./store.mjs";
import { createApp } from "./app.mjs";

const temporaryPreview = process.env.TEMPORARY_PREVIEW === "1";
const databasePath = resolve(".local/everoutward.sqlite");
const store = temporaryPreview
  ? createPreviewStore(databasePath)
  : createStore(databasePath);
const { places } = JSON.parse(readFileSync("public/data/places.json", "utf8"));
let initialHome = null;
try {
  initialHome = JSON.parse(readFileSync(".local/initial-home.json", "utf8"));
} catch {}
// Access to this local server grants editing access without a password.
const app = createApp({
  store,
  places,
  initialHome,
  localOwner: true,
  temporaryPreview,
});
// Checks resume from the saved timestamps; only the local server contacts NT.
const stopAccessChecks = app.locals.accessMonitor.start();
process.once("exit", stopAccessChecks);
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const port = Number(process.env.PORT || 3001);
app.listen(port, "127.0.0.1", () =>
  console.log(`Local owner API: http://127.0.0.1:${port}`),
);
