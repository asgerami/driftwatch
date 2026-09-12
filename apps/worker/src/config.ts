import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  dataDir: resolve(process.env["DATA_DIR"] ?? "./.data"),
  githubToken: process.env["GITHUB_TOKEN"] ?? "",
};

export const paths = {
  repos: resolve(config.dataDir, "repos"),
  blobs: resolve(config.dataDir, "blobs"),
};
