import fs from 'node:fs/promises';
import path from 'node:path';

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

async function requestJson(apiPath, { allowEmptyRepo = false } = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (allowEmptyRepo && response.status === 409) return [];
  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}.`);
  }
  return response.json();
}

async function paginate(apiPath, options = {}) {
  const separator = apiPath.includes('?') ? '&' : '?';
  const results = [];
  for (let page = 1; ; page += 1) {
    const batch = await requestJson(`${apiPath}${separator}per_page=100&page=${page}`, options);
    if (!Array.isArray(batch)) throw new Error('Unexpected GitHub API response.');
    results.push(...batch);
    if (batch.length < 100) break;
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

const repos = await paginate('/user/repos?affiliation=owner&visibility=all&sort=updated&direction=desc');
const targets = repos.filter((repo) => !repo.fork && repo.full_name !== repository);

const uniqueCommits = new Map();
let repositoriesWithCommits = 0;

for (const repo of targets) {
  const branches = await paginate(`/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/branches`, { allowEmptyRepo: true });
  let repoHasCommits = false;

  for (const branch of branches) {
    const commits = await paginate(
      `/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/commits?sha=${encodeURIComponent(branch.name)}&author=${encodeURIComponent(username)}`,
      { allowEmptyRepo: true },
    );

    for (const commit of commits) {
      if ((commit.parents?.length ?? 0) > 1) continue;
      uniqueCommits.set(`${repo.id}:${commit.sha}`, { owner: repo.owner.login, repo: repo.name, sha: commit.sha });
      repoHasCommits = true;
    }
  }

  if (repoHasCommits) repositoriesWithCommits += 1;
}

const totals = new Map();
const commitList = [...uniqueCommits.values()];
let cursor = 0;

async function worker() {
  while (cursor < commitList.length) {
    const index = cursor++;
    const item = commitList[index];
    const detail = await requestJson(`/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.repo)}/commits/${item.sha}?per_page=100`);
    const files = detail.files ?? [];

    for (const file of files) {
      const language = languageForFile(file.filename);
      if (!language) continue;
      const changes = Number(file.changes ?? ((file.additions ?? 0) + (file.deletions ?? 0)));
      if (!Number.isFinite(changes) || changes <= 0) continue;
      totals.set(language, (totals.get(language) ?? 0) + changes);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(8, Math.max(1, commitList.length)) }, () => worker()));

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
  commits: uniqueCommits.size,
  repositories: repositoriesWithCommits,
};

await fs.mkdir('profile', { recursive: true });
await Promise.all([
  fs.writeFile('profile/recent-language-activity-light.svg', makeSvg(rows, meta, 'light')),
  fs.writeFile('profile/recent-language-activity-dark.svg', makeSvg(rows, meta, 'dark')),
]);

console.log(`Generated all-time language activity cards from ${meta.commits} deduplicated commits across ${meta.repositories} repositories.`);
