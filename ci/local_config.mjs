// Optional local paths for development commands. Each setting comes from .local/config.json
// (git-ignored), then its environment variable, then its default below the home directory, if
// it has one. config/local-paths.json lists the settings, variables and defaults.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const settings = JSON.parse(readFileSync(resolve(root, 'config/local-paths.json'), 'utf8'));

export function validateConfig(config) {
  const keys = Object.keys(settings);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Local config must be an object');
  for (const [key, value] of Object.entries(config)) {
    if (!keys.includes(key)) throw new Error(`Unknown local setting: ${key}`);
    if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`${key} must be an absolute path`);
  }
  return config;
}

/** Local file, then the environment, then the default. MD_LOCAL_CONFIG names another config file. */
export function config(env = process.env, home = homedir()) {
  const path = env.MD_LOCAL_CONFIG ?? resolve(root, '.local/config.json');
  if (env.MD_LOCAL_CONFIG && !existsSync(path)) throw new Error(`Missing explicit configuration: ${path}`);
  const local = validateConfig(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
  const result = {};
  for (const [key, rule] of Object.entries(settings)) {
    const value = local[key] ?? (env[rule.env] || undefined) ?? (rule.home ? resolve(home, rule.home) : undefined);
    if (value !== undefined && value !== '') result[key] = value;
  }
  return validateConfig(result);
}

/** The process environment with every configured setting exported under its variable name. */
export function environment(c = config()) {
  return { ...process.env, ...Object.fromEntries(Object.entries(c).map(([key, value]) => [settings[key].env, value])) };
}

export function required(c, keys) {
  for (const key of keys) if (!c[key] || !existsSync(c[key]))
    throw new Error(`Set ${key} to an existing path in .local/config.json or ${settings[key].env} (see CONTRIBUTING.md)`);
}
