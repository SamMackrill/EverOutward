import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { createStore } from "./store.mjs";
import { createApp } from "./app.mjs";

const store = createStore(resolve(".local/everoutward.sqlite"));
const { places } = JSON.parse(readFileSync("public/data/places.json", "utf8"));
let initialHome = null;
try {
  initialHome = JSON.parse(readFileSync(".local/initial-home.json", "utf8"));
} catch {}
const app = createApp({ store, places, initialHome });
app.use(express.static(resolve("dist")));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
const port = Number(process.env.PORT || 3001);
app.listen(port, "127.0.0.1", () =>
  console.log(`Local owner API: http://127.0.0.1:${port}`),
);
