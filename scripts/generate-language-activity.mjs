import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const token = process.env.GH_STATS_TOKEN;
const username = process.env.GH_USERNAME;
const repository = process.env.GITHUB_REPOSITORY;

if (!token) throw new Error('PROFILE_STATS_TOKEN is required.');
if (!username) throw new Error('GH_USERNAME is required.');

const collectedAt = new Date();

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'profile-language-activity',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(apiPath, { allowEmptyRepo = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://api.github.com${apiPath}`, { headers });
    if (allowEmptyRepo && response.status === 409) return [];
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

async function paginate(apiPath, options = {}) {
  const separator = apiPath.includes('?') ? '&' : '?';
  const results = [];
  for (let page = 1; ; page += 1) {
    const batch = await requestJson(`${apiPath}${separator}per_page=100&page=${page}`, options);
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub API response.');
    results.push(...batch);
    if (batch.length < 100) break;
    await sleep(40);
  }
  return results;
}

function languageForFile(filename) {
  const lower = filename.toLowerCase();
  const base = path.posix.basename(lower);

  if (
    lower.includes('/node_modules/') ||
    lower.includes('/vendor/') ||
    lower.includes('/dist/') ||
    lower.includes('/build/') ||
    lower.includes('/coverage/') ||
    lower.includes('/.next/') ||
    lower.includes('/.nuxt/') ||
    lower.includes('/public/build/') ||
    lower.includes('/public/assets/') ||
    lower.includes('/tmp/') ||
    lower.includes('/log/') ||
    lower.endsWith('.map') ||
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    base === 'schema.rb' ||
    base === 'structure.sql'
  ) return null;

  if (['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'gemfile.lock', 'composer.lock'].includes(base)) return null;

  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return 'TypeScript';
  if (lower.endsWith('.jsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'JavaScript';
  if (lower.endsWith('.vue')) return 'Vue.js';
  if (lower.endsWith('.rb') || lower.endsWith('.rake') || lower.endsWith('.erb') || ['gemfile', 'rakefile', 'config.ru'].includes(base)) return 'Ruby';
  if (lower.endsWith('.php')) return 'PHP';
  if (lower.endsWith('.py')) return 'Python';
  if (lower.endsWith('.go')) return 'Go';
  if (lower.endsWith('.rs')) return 'Rust';
  if (lower.endsWith('.java')) return 'Java';
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'Kotlin';
  if (lower.endsWith('.swift')) return 'Swift';
  if (lower.endsWith('.cs')) return 'C#';
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.hpp')) return 'C++';
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'C';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'Shell';
  if (lower.endsWith('.sql')) return 'SQL';
  if (lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less') || lower.endsWith('.css')) return 'CSS';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'HTML';

  return null;
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

function makeSvg(rows, meta, theme) {
  const dark = theme === 'dark';
  const palette = dark
    ? {
        bg: '#241E1A', border: '#51443A', text: '#F5EBDD', muted: '#BBA898', track: '#3A312B',
        bars: ['#E07A5F', '#DDA85D', '#A3AD78', '#C98B80', '#B49A86'],
      }
    : {
        bg: '#FFF9F1', border: '#E7D8C9', text: '#3A302A', muted: '#8A7566', track: '#EFE4D8',
        bars: ['#C9684C', '#C99545', '#89965F', '#B9776D', '#9F8875'],
      };

  const width = 640;
  const height = 372;
  const barX = 188;
  const barWidth = 330;
  const rowStart = 126;
  const rowGap = 43;

  const rowMarkup = rows.map((row, index) => {
    const y = rowStart + index * rowGap;
    const fillWidth = Math.max(4, barWidth * row.ratio);
    const color = palette.bars[index] ?? palette.bars.at(-1);
    return `
      <text x="30" y="${y + 4}" fill="${palette.text}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="600">${escapeXml(row.language)}</text>
      <rect x="${barX}" y="${y - 8}" width="${barWidth}" height="12" rx="6" fill="${palette.track}"/>
      <rect x="${barX}" y="${y - 8}" width="${fillWidth.toFixed(1)}" height="12" rx="6" fill="${color}"/>
      <text x="602" y="${y + 4}" fill="${palette.text}" font-family="ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="13" font-weight="700" text-anchor="end">${row.percent.toFixed(1)}%</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
    <title id="title">Language activity history for ${escapeXml(username)}</title>
    <desc id="desc">All-time changed lines across owned public and private repositories and all branches, deduplicated by commit.</desc>
    <rect width="${width}" height="${height}" rx="16" fill="${palette.bg}"/>
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="15.5" fill="none" stroke="${palette.border}"/>
    <text x="30" y="42" fill="${palette.text}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="24" font-weight="700">開発言語</text>
    <text x="30" y="68" fill="${palette.muted}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" font-weight="500">最古〜現在 · 変更行数ベース</text>
    <text x="610" y="42" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="11" text-anchor="end">${formatDate(collectedAt)}</text>
    <line x1="30" y1="91" x2="610" y2="91" stroke="${palette.border}"/>
    ${rowMarkup}
    <line x1="30" y1="335" x2="610" y2="335" stroke="${palette.border}"/>
    <text x="30" y="356" fill="${palette.muted}" font-family="ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="10">public + private · 全ブランチ · 重複コミット除外</text>
    <text x="610" y="356" fill="${palette.muted}" font-family="ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="10" text-anchor="end">${meta.commits} commits / ${meta.repositories} repos</text>
  </svg>`;
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`git command failed with exit code ${result.status}.`);
  }
  return result.stdout ?? '';
}

const repos = await paginate('/user/repos?affiliation=owner&visibility=all&sort=updated&direction=desc');
const targets = repos.filter((repo) => !repo.fork && repo.full_name !== repository);

const commitsByRepo = new Map();
let uniqueCommitCount = 0;

for (const repo of targets) {
  const branches = await paginate(`/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/branches`, { allowEmptyRepo: true });
  const shas = new Set();

  for (const branch of branches) {
    const commits = await paginate(
      `/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/commits?sha=${encodeURIComponent(branch.name)}&author=${encodeURIComponent(username)}`,
      { allowEmptyRepo: true },
    );

    for (const commit of commits) {
      if ((commit.parents?.length ?? 0) > 1) continue;
      shas.add(commit.sha);
    }
  }

  if (shas.size > 0) {
    commitsByRepo.set(repo.full_name, { repo, shas });
    uniqueCommitCount += shas.size;
  }
}

const totals = new Map();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-language-'));
const basicAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
};

try {
  let repoIndex = 0;
  for (const { repo, shas } of commitsByRepo.values()) {
    repoIndex += 1;
    const repoDir = path.join(tempRoot, `repo-${repoIndex}`);
    runGit(['clone', '--mirror', '--quiet', repo.clone_url, repoDir], { env: gitEnv });

    const log = runGit([
      '-C', repoDir,
      'log', '--all', '--no-merges', '--no-renames', '--numstat', '--format=@@COMMIT:%H',
    ]);

    let include = false;
    for (const line of log.split('\n')) {
      if (line.startsWith('@@COMMIT:')) {
        include = shas.has(line.slice('@@COMMIT:'.length).trim());
        continue;
      }
      if (!include || !line) continue;

      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const additions = Number(parts[0]);
      const deletions = Number(parts[1]);
      if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;

      const filename = parts.slice(2).join('\t');
      const language = languageForFile(filename);
      if (!language) continue;

      const changes = additions + deletions;
      if (changes <= 0) continue;
      totals.set(language, (totals.get(language) ?? 0) + changes);
    }

    await fs.rm(repoDir, { recursive: true, force: true });
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
const grandTotal = sorted.reduce((sum, [, value]) => sum + value, 0);
if (grandTotal === 0) throw new Error('No language activity was found.');

const top = sorted.slice(0, 4);
const other = sorted.slice(4).reduce((sum, [, value]) => sum + value, 0);
if (other > 0) top.push(['Other', other]);

const rows = top.map(([language, value]) => ({
  language,
  value,
  ratio: value / grandTotal,
  percent: (value / grandTotal) * 100,
}));

const meta = {
  commits: uniqueCommitCount,
  repositories: commitsByRepo.size,
};

await fs.mkdir('profile', { recursive: true });
await Promise.all([
  fs.writeFile('profile/recent-language-activity-light.svg', makeSvg(rows, meta, 'light')),
  fs.writeFile('profile/recent-language-activity-dark.svg', makeSvg(rows, meta, 'dark')),
]);

console.log(`Generated all-time language activity cards from ${meta.commits} deduplicated commits across ${meta.repositories} repositories.`);
