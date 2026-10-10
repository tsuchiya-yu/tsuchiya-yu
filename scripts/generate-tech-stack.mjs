import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const token = process.env.GH_STATS_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!token) throw new Error('PROFILE_STATS_TOKEN is required.');
if (!repository) throw new Error('GITHUB_REPOSITORY is required.');

const collectedAt = new Date();

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'profile-tech-stack',
};

const ignoredDirectories = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.next', '.nuxt',
  'tmp', 'log', '.cache', '.turbo', '.output', 'public/build', 'public/assets',
]);

const technologyOrder = [
  'Rails',
  'Laravel',
  'React',
  'Next.js',
  'Vue.js',
  'Tailwind CSS',
  'Inertia.js',
  'Supabase',
  'Cloudflare Workers',
  'Cloudflare D1',
  'PlayCanvas',
  'Docker',
  'Express',
  'NestJS',
  'Svelte',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(apiPath) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://api.github.com${apiPath}`, { headers });
    if (response.ok) return response.json();

    if ((response.status === 403 || response.status === 429) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const waitMs = retryAfter > 0 && retryAfter <= 60
        ? retryAfter * 1000
        : Math.min(15000, 1500 * (2 ** attempt));
      await sleep(waitMs);
      continue;
    }

    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    throw new Error(`GitHub API request failed with status ${response.status}; remaining=${remaining ?? 'unknown'}; reset=${reset ?? 'unknown'}.`);
  }

  throw new Error('GitHub API request failed after retries.');
}

async function paginate(apiPath) {
  const separator = apiPath.includes('?') ? '&' : '?';
  const results = [];

  for (let page = 1; ; page += 1) {
    const batch = await requestJson(`${apiPath}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub API response.');
    results.push(...batch);
    if (batch.length < 100) break;
    await sleep(40);
  }

  return results;
}

function isSampleLikeRepository(name) {
  const lower = name.toLowerCase();
  return lower.includes('sample') || /(^|[-_])(demo|tutorial|sandbox|playground)([-_]|$)/.test(lower);
}

function runGit(args, options = {}, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git command failed with exit code ${result.status}.`);
  }

  return result;
}

async function walkRelevantFiles(root) {
  const files = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name) || ignoredDirectories.has(relativePath)) continue;
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const base = entry.name.toLowerCase();
      if (
        base === 'gemfile' ||
        base === 'composer.json' ||
        base === 'package.json' ||
        base === 'wrangler.toml' ||
        base === 'wrangler.json' ||
        base === 'wrangler.jsonc' ||
        base === 'dockerfile' ||
        base === 'docker-compose.yml' ||
        base === 'docker-compose.yaml' ||
        base === 'compose.yml' ||
        base === 'compose.yaml' ||
        relativePath === 'supabase/config.toml'
      ) {
        files.push({ fullPath, relativePath, base });
      }
    }
  }

  await walk(root);
  return files;
}

function dependencyNames(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
}

async function detectTechnologies(repoRoot) {
  const technologies = new Set();
  const files = await walkRelevantFiles(repoRoot);

  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file.fullPath, 'utf8');
    } catch {
      continue;
    }

    if (file.base === 'gemfile') {
      if (/\bgem\s*\(?\s*['"]rails['"]/.test(content)) technologies.add('Rails');
      continue;
    }

    if (file.base === 'composer.json') {
      try {
        const composer = JSON.parse(content);
        const dependencies = {
          ...(composer.require ?? {}),
          ...(composer['require-dev'] ?? {}),
        };
        if (dependencies['laravel/framework'] || dependencies['laravel/lumen-framework']) {
          technologies.add('Laravel');
        }
      } catch {
        // Ignore malformed manifests instead of failing the whole card generation.
      }
      continue;
    }

    if (file.base === 'package.json') {
      try {
        const packageJson = JSON.parse(content);
        const dependencies = dependencyNames(packageJson);

        if (dependencies.has('react') || dependencies.has('react-dom')) technologies.add('React');
        if (dependencies.has('next')) technologies.add('Next.js');
        if (dependencies.has('vue')) technologies.add('Vue.js');
        if (dependencies.has('tailwindcss')) technologies.add('Tailwind CSS');
        if ([...dependencies].some((name) => name.startsWith('@inertiajs/'))) technologies.add('Inertia.js');
        if ([...dependencies].some((name) => name.startsWith('@supabase/'))) technologies.add('Supabase');
        if (dependencies.has('playcanvas')) technologies.add('PlayCanvas');
        if (dependencies.has('express')) technologies.add('Express');
        if (dependencies.has('@nestjs/core')) technologies.add('NestJS');
        if (dependencies.has('svelte')) technologies.add('Svelte');
        if (dependencies.has('wrangler')) technologies.add('Cloudflare Workers');
      } catch {
        // Ignore malformed manifests instead of failing the whole card generation.
      }
      continue;
    }

    if (['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'].includes(file.base)) {
      technologies.add('Cloudflare Workers');
      if (/d1_databases|"d1_databases"/.test(content)) technologies.add('Cloudflare D1');
      continue;
    }

    if (file.relativePath === 'supabase/config.toml') {
      technologies.add('Supabase');
      continue;
    }

    if (
      file.base === 'dockerfile' ||
      file.base === 'docker-compose.yml' ||
      file.base === 'docker-compose.yaml' ||
      file.base === 'compose.yml' ||
      file.base === 'compose.yaml'
    ) {
      technologies.add('Docker');
    }
  }

  return technologies;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function sortTechnologies(entries) {
  const priority = new Map(technologyOrder.map((name, index) => [name, index]));
  return entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return (priority.get(a[0]) ?? 999) - (priority.get(b[0]) ?? 999) || a[0].localeCompare(b[0]);
  });
}

function wrapOneOffs(names, maxLength = 54) {
  const lines = [];
  let current = '';

  for (const name of names) {
    const next = current ? `${current} ・ ${name}` : name;
    if (current && next.length > maxLength) {
      lines.push(current);
      current = name;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function makeSvg(entries, meta, theme) {
  const dark = theme === 'dark';
  const palette = dark
    ? {
        bg: '#241E1A', border: '#51443A', text: '#F5EBDD', muted: '#BBA898', track: '#3A312B',
        bars: ['#E07A5F', '#DDA85D', '#A3AD78', '#C98B80', '#B49A86', '#8FA7BD', '#A395AA', '#9A8B72'],
      }
    : {
        bg: '#FFF9F1', border: '#E7D8C9', text: '#3A302A', muted: '#8A7566', track: '#EFE4D8',
        bars: ['#C9684C', '#C99545', '#89965F', '#B9776D', '#9F8875', '#7F9DB8', '#94879E', '#8F8068'],
      };

  const multi = entries.filter(([, count]) => count >= 2);
  const oneOffs = entries.filter(([, count]) => count === 1).map(([name]) => name);
  const oneOffLines = wrapOneOffs(oneOffs);
  const maxCount = Math.max(1, ...multi.map(([, count]) => count));

  const width = 640;
  const barX = 220;
  const barWidth = 292;
  const rowStart = 126;
  const rowGap = 39;
  const multiEndY = multi.length > 0 ? rowStart + (multi.length - 1) * rowGap : rowStart - rowGap;
  const oneOffHeaderY = oneOffLines.length > 0 ? multiEndY + 44 : null;
  const oneOffStartY = oneOffHeaderY === null ? null : oneOffHeaderY + 24;
  const contentEndY = oneOffStartY === null
    ? multiEndY + 8
    : oneOffStartY + Math.max(0, oneOffLines.length - 1) * 22;
  const footerLineY = Math.max(184, contentEndY + 34);
  const footerTextY = footerLineY + 21;
  const height = footerTextY + 16;

  const rowMarkup = multi.map(([technology, count], index) => {
    const y = rowStart + index * rowGap;
    const fillWidth = Math.max(4, barWidth * (count / maxCount));
    const color = palette.bars[index] ?? palette.bars.at(-1);
    return `
      <text x="30" y="${y + 4}" fill="${palette.text}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="600">${escapeXml(technology)}</text>
      <rect x="${barX}" y="${y - 8}" width="${barWidth}" height="12" rx="6" fill="${palette.track}"/>
      <rect x="${barX}" y="${y - 8}" width="${fillWidth.toFixed(1)}" height="12" rx="6" fill="${color}"/>
      <text x="602" y="${y + 4}" fill="${palette.text}" font-family="ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="13" font-weight="700" text-anchor="end">${count}件</text>`;
  }).join('');

  const oneOffMarkup = oneOffLines.length === 0 ? '' : `
    <text x="30" y="${oneOffHeaderY}" fill="${palette.muted}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" font-weight="700">1件のみ</text>
    ${oneOffLines.map((line, index) => `<text x="30" y="${oneOffStartY + index * 22}" fill="${palette.text}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">${escapeXml(line)}</text>`).join('\n    ')}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
    <title id="title">個人開発で使ってきた技術</title>
    <desc id="desc">個人所有リポジトリの現在の構成から、技術ごとの採用リポジトリ数を集計したカードです。</desc>
    <rect width="${width}" height="${height}" rx="16" fill="${palette.bg}"/>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="15.5" fill="none" stroke="${palette.border}"/>
    <text x="30" y="42" fill="${palette.text}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="24" font-weight="700">使ってきた技術</text>
    <text x="30" y="68" fill="${palette.muted}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" font-weight="500">個人開発での採用リポジトリ数</text>
    <text x="610" y="42" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="11" text-anchor="end">${formatDate(collectedAt)}</text>
    <line x1="30" y1="91" x2="610" y2="91" stroke="${palette.border}"/>
    ${rowMarkup}
    ${oneOffMarkup}
    <line x1="30" y1="${footerLineY}" x2="610" y2="${footerLineY}" stroke="${palette.border}"/>
    <text x="30" y="${footerTextY}" fill="${palette.muted}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10">公開・非公開の個人リポジトリを集計</text>
    <text x="610" y="${footerTextY}" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="10" text-anchor="end">${meta.repositories}件を分析</text>
  </svg>`;
}

const repos = await paginate('/user/repos?affiliation=owner&visibility=all&sort=updated&direction=desc');
const candidateRepos = repos.filter((repo) => !repo.fork && !repo.is_template && repo.full_name !== repository);
const targets = candidateRepos.filter((repo) => !isSampleLikeRepository(repo.name));
const excludedCount = candidateRepos.length - targets.length;

const counts = new Map();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-tech-stack-'));
const basicAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
};

let analyzedRepositories = 0;
let skippedRepositories = 0;

try {
  let repoIndex = 0;

  for (const repo of targets) {
    repoIndex += 1;
    const repoDir = path.join(tempRoot, `repo-${repoIndex}`);
    const clone = runGit([
      'clone', '--quiet', '--depth', '1', '--single-branch', '--branch', repo.default_branch,
      repo.clone_url, repoDir,
    ], { env: gitEnv }, { allowFailure: true });

    if (clone.status !== 0) {
      skippedRepositories += 1;
      continue;
    }

    const technologies = await detectTechnologies(repoDir);
    analyzedRepositories += 1;

    for (const technology of technologies) {
      counts.set(technology, (counts.get(technology) ?? 0) + 1);
    }

    await fs.rm(repoDir, { recursive: true, force: true });
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

const entries = sortTechnologies([...counts.entries()]);
if (entries.length === 0) throw new Error('No supported technologies were detected.');

console.log('Technology adoption counts:');
for (const [technology, count] of entries) {
  console.log(`${technology}: ${count}`);
}
console.log(`Analyzed ${analyzedRepositories} repositories; excluded ${excludedCount} sample/demo/template repositories; skipped ${skippedRepositories}.`);

const meta = { repositories: analyzedRepositories };

await fs.mkdir('profile', { recursive: true });
await Promise.all([
  fs.writeFile('profile/tech-stack-light.svg', makeSvg(entries, meta, 'light')),
  fs.writeFile('profile/tech-stack-dark.svg', makeSvg(entries, meta, 'dark')),
]);

console.log('Generated technology adoption cards.');
