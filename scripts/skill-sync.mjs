#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createState(date, extra = {}) {
  return {
    syncDate: date,
    syncCompleted: false,
    queryTime: null,
    query: null,
    topRepositories: [],
    installedCandidates: [],
    mappingVersion: '1',
    failure: null,
    ...extra,
  };
}

export async function readState(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

function routeForSkill(name, description = '') {
  const text = `${name} ${description}`.toLowerCase();
  if (/research|web|market|competitive|search/.test(text)) return 'Research or competitive analysis';
  if (/review|audit|security|triage/.test(text)) return 'Code review';
  if (/test|debug|qa|verification|tdd/.test(text)) return 'Bug investigation';
  if (/plan|implement|prototype|build|feature/.test(text)) return 'New software feature';
  if (/writing|document|pdf|report/.test(text)) return 'Word, PDF, or report';
  return 'General workflow';
}

function parseSkillFrontmatter(content, fallbackName) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = match?.[1] ?? '';
  const read = (key) => frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'mi'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  return { name: read('name') || fallbackName, description: read('description') };
}

async function findSkillFiles(root) {
  const results = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name === 'SKILL.md') results.push(fullPath);
    }
  }
  await visit(root);
  return results;
}

function keywordList(name, description, route) {
  const stopWords = new Set(['use', 'when', 'this', 'that', 'with', 'from', 'into', 'for', 'and', 'the', 'skill']);
  const routeAliases = {
    'Research or competitive analysis': ['研究', '调研', '搜索', '资料', '竞品'],
    'Code review': ['代码', '审查', '评审', '审核'],
    'Bug investigation': ['故障', '调试', '测试', '验证', '问题'],
    'New software feature': ['开发', '实现', '功能', '编程'],
    'Word, PDF, or report': ['文档', '报告', '写作', '文件'],
  }[route] ?? [];
  const nameSuggestsRoute = {
    'Research or competitive analysis': /research|market|competitive|search|web/.test(name),
    'Code review': /review|audit|security|triage/.test(name),
    'Bug investigation': /test|debug|qa|verification|tdd/.test(name),
    'New software feature': /plan|implement|prototype|build|feature/.test(name),
    'Word, PDF, or report': /writing|document|pdf|report/.test(name),
  }[route] ?? false;
  return [...new Set([...( `${name} ${description}`.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []), ...(nameSuggestsRoute ? routeAliases : [])])]
    .filter((word) => !stopWords.has(word) && (/[a-z]/.test(word) || nameSuggestsRoute));
}

export async function buildWorkflowIndex({ skillsRoot, indexFile, sourceBySkill = {} }) {
  const previous = await readState(indexFile);
  const previousSources = Object.fromEntries((previous?.skills ?? []).filter((skill) => skill.source).map((skill) => [skill.name, skill.source]));
  const sources = { ...previousSources, ...sourceBySkill };
  const skillFiles = await findSkillFiles(skillsRoot);
  const skills = [];
  for (const skillFile of skillFiles) {
    const fallbackName = path.basename(path.dirname(skillFile));
    const metadata = parseSkillFrontmatter(await fs.readFile(skillFile, 'utf8'), fallbackName);
    const route = routeForSkill(metadata.name, metadata.description);
    skills.push({
      name: metadata.name,
      description: metadata.description,
      route,
      path: path.resolve(skillFile),
      source: sources[metadata.name] ?? 'local',
      keywords: keywordList(metadata.name, metadata.description, route),
      readBeforeWork: true,
    });
  }
  skills.sort((left, right) => left.name.localeCompare(right.name));
  const index = { version: '1', generatedAt: new Date().toISOString(), skills };
  await writeState(indexFile, index);
  return index;
}

export function selectSkillsForPrompt(index, prompt, { maxResults = 3, minScore = 2 } = {}) {
  const normalizedPrompt = String(prompt).toLowerCase();
  return (index?.skills ?? []).map((skill) => {
    const reasons = skill.keywords.filter((keyword) => normalizedPrompt.includes(keyword));
    if (normalizedPrompt.includes(skill.name.toLowerCase())) reasons.push(`name:${skill.name}`);
    if (normalizedPrompt.includes(skill.route.toLowerCase())) reasons.push(`route:${skill.route}`);
    return { ...skill, reasons: [...new Set(reasons)], score: new Set(reasons).size, readBeforeWork: true };
  }).filter((skill) => skill.score >= minScore).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)).slice(0, maxResults);
}

export async function prepareWorkflow({ skillsRoot, indexFile, prompt, sourceBySkill = {}, maxResults = 3 }) {
  const index = await buildWorkflowIndex({ skillsRoot, indexFile, sourceBySkill });
  return { index, selected: selectSkillsForPrompt(index, prompt, { maxResults }) };
}

export async function shouldSync(file, localDate, { retryRateLimit = false } = {}) {
  const state = await readState(file);
  return !state || state.syncDate !== localDate || (retryRateLimit && state.syncDate === localDate && state.rateLimited === true);
}

export function validateCandidate(candidate) {
  if (candidate?.inspectionError) return { valid: false, inconclusive: true, reason: candidate.inspectionError };
  const valid = Boolean(
    candidate?.fullName &&
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(candidate.htmlUrl ?? '') &&
    candidate.defaultBranch &&
    candidate.skillPaths?.length > 0 &&
    candidate.license,
  );
  return { valid, reason: valid ? null : 'missing trusted URL, skill directory, SKILL.md, or license' };
}

export function getInstallableCandidates(state) {
  return (state?.topRepositories ?? []).filter((candidate) => candidate.validation === 'accepted');
}

export function selectConfirmedCandidates(state, confirmations) {
  const allowed = new Map(getInstallableCandidates(state).map((candidate) => [candidate.fullName, candidate]));
  return confirmations.map((confirmation) => {
    const candidate = allowed.get(confirmation.repo);
    if (!candidate) throw new Error(`Candidate was not validated: ${confirmation.repo}`);
    const paths = confirmation.paths?.length ? confirmation.paths : candidate.skillPaths;
    const invalid = paths.filter((skillPath) => !candidate.skillPaths.includes(skillPath));
    if (invalid.length) throw new Error(`Skill path was not validated for ${confirmation.repo}: ${invalid.join(', ')}`);
    return { candidate, paths };
  });
}

export function suggestWorkflowMappings(paths) {
  const mappings = [];
  for (const skillPath of paths) {
    const name = path.basename(path.dirname(skillPath)).toLowerCase();
    const route = routeForSkill(name);
    mappings.push({ skillPath, skillName: name, route, action: 'suggest' });
  }
  return mappings;
}

function runInstaller({ repo, ref, paths, installer, python, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [installer, '--repo', repo, '--ref', ref, '--path', ...paths, '--method', 'git'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `installer exited with ${code}`)));
  });
}

export async function installConfirmed({ stateFile, confirmations, installer, python = process.env.PYTHON ?? 'python', env = process.env, destination = path.join(env.CODEX_HOME ?? path.join(env.USERPROFILE ?? '.', '.codex'), 'skills'), indexFile = path.join(path.dirname(stateFile), 'skill-workflow-index.json') }) {
  const state = await readState(stateFile);
  if (!state) throw new Error('No synchronization state exists. Run sync first.');
  const selected = selectConfirmedCandidates(state, confirmations);
  const installed = [];
  for (const { candidate, paths: selectedPaths } of selected) {
    const paths = selectedPaths.map((skillPath) => skillPath.replace(/\/SKILL\.md$/i, ''));
    const pending = [];
    const results = [];
    for (const skillPath of paths) {
      const skillName = path.basename(skillPath);
      if (await fs.access(path.join(destination, skillName)).then(() => true).catch(() => false)) {
        results.push({ skillPath, skillName, status: 'already-installed' });
      } else pending.push(skillPath);
    }
    if (pending.length) {
      const outputs = [];
      for (const skillPath of pending) {
        const skillName = path.basename(skillPath);
        try {
          outputs.push(await runInstaller({ repo: candidate.fullName, ref: candidate.defaultBranch, paths: [skillPath], installer, python, env }));
          results.push({ skillPath: `${skillPath}/SKILL.md`, skillName, status: 'installed' });
        } catch (error) {
          if (/Destination already exists/i.test(error.message)) results.push({ skillPath: `${skillPath}/SKILL.md`, skillName, status: 'already-installed' });
          else throw error;
        }
        const partial = { repo: candidate.fullName, paths: results.map((item) => item.skillPath), commit: candidate.commit, output: outputs.join('\n'), status: 'in-progress', results: [...results] };
        state.installedCandidates = [...(state.installedCandidates ?? []).filter((item) => item.repo !== candidate.fullName), partial];
        await writeState(stateFile, state);
      }
      installed.push({ repo: candidate.fullName, paths: pending.map((skillPath) => `${skillPath}/SKILL.md`), commit: candidate.commit, output: outputs.join('\n'), status: 'installed', results });
    } else installed.push({ repo: candidate.fullName, paths: paths.map((skillPath) => `${skillPath}/SKILL.md`), commit: candidate.commit, output: '', status: 'already-installed', results });
    state.installedCandidates = [...(state.installedCandidates ?? []).filter((item) => item.repo !== candidate.fullName), installed[installed.length - 1]];
    state.workflowMappings = [...(state.workflowMappings ?? []).filter((item) => item.repo !== candidate.fullName), ...suggestWorkflowMappings(paths).map((mapping) => ({ repo: candidate.fullName, ...mapping, status: 'review-on-next-request' }))];
    await writeState(stateFile, state);
  }
  state.installedCandidates = [...(state.installedCandidates ?? []).filter((item) => !installed.some((entry) => entry.repo === item.repo)), ...installed];
  const sourceBySkill = {};
  for (const entry of installed) {
    for (const result of entry.results) sourceBySkill[result.skillName] = `${entry.repo}@${entry.commit}`;
  }
  const workflowIndex = await buildWorkflowIndex({ skillsRoot: destination, indexFile, sourceBySkill });
  state.workflowIndexFile = indexFile;
  state.workflowIndexVersion = workflowIndex.version;
  await writeState(stateFile, state);
  return { installed, state, workflowIndex };
}

function isRateLimitError(error) {
  return error?.rateLimited === true || error?.status === 429 || (error?.status === 403 && error?.message?.toLowerCase().includes('rate'));
}

export async function sync({ stateFile, localDate, fetchJson, inspectCandidate = async (item) => item, installedSkills = [], install = false, retryRateLimit = false }) {
  if (!(await shouldSync(stateFile, localDate, { retryRateLimit }))) return { skipped: true, state: await readState(stateFile) };

  const started = new Date().toISOString();
  const state = createState(localDate, {
    queryTime: started,
    query: 'skill in:name,description,readme sort:stars-desc',
  });
  try {
    const result = await fetchJson();
    const candidates = [];
    for (const item of result.items ?? []) {
      let details;
      try {
        details = await inspectCandidate(item);
      } catch (error) {
        const rateLimited = isRateLimitError(error);
        details = { skillPaths: [], license: item.license?.spdx_id ?? item.license, commit: null, rateLimited, inspectionError: rateLimited ? 'inconclusive: GitHub API rate limit' : `inconclusive: ${error.message}` };
        state.rateLimited ||= rateLimited;
      }
      const candidate = {
        fullName: item.full_name,
        htmlUrl: item.html_url,
        owner: item.owner?.login,
        stars: item.stargazers_count,
        defaultBranch: item.default_branch,
        commit: details.commit,
        skillPaths: details.skillPaths ?? [],
        license: details.license?.spdx_id ?? details.license,
        rateLimited: details.rateLimited ?? false,
        inspectionError: details.inspectionError ?? null,
      };
      const validation = validateCandidate(candidate);
      candidates.push({ ...candidate, validation: validation.inconclusive ? validation.reason : validation.reason ?? 'accepted' });
    }
    state.topRepositories = candidates;
    state.installedCandidates = install
      ? candidates.filter((candidate) => candidate.validation === 'accepted' && !installedSkills.includes(candidate.fullName)).map((candidate) => ({ ...candidate, status: 'not-installed-by-default' }))
      : [];
    state.syncCompleted = !state.rateLimited && candidates.every((candidate) => !candidate.inspectionError);
    if (!state.syncCompleted && !state.failure) state.failure = 'One or more candidates could not be inspected';
    await writeState(stateFile, state);
    return { skipped: false, state };
  } catch (error) {
    state.failure = `${error.name}: ${error.message}`;
    await writeState(stateFile, state);
    return { skipped: false, state };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const stateFile = process.env.CODEX_SKILL_SYNC_STATE ?? path.join(process.env.CODEX_HOME ?? process.env.USERPROFILE ?? '.', '.codex', 'skill-sync-state.json');
  const apiUrl = 'https://api.github.com/search/repositories?q=skill+in:name,description,readme&sort=stars&order=desc&per_page=10';
  const github = async (url) => {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const response = await fetch(url, { headers: { 'User-Agent': 'Codex-Skill-Sync', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!response.ok) {
      const error = new Error(`GitHub API returned ${response.status} for ${url}`);
      error.status = response.status;
      error.rateLimited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      throw error;
    }
    return response.json();
  };
  const confirmFileIndex = process.argv.indexOf('--confirm-file');
  const confirmIndex = process.argv.indexOf('--confirm');
  const prepareIndex = process.argv.indexOf('--prepare');
  if (prepareIndex >= 0) {
    const prompt = process.argv.slice(prepareIndex + 1).join(' ').trim();
    if (!prompt) throw new Error('--prepare requires the user request text.');
    const skillsRoot = process.env.CODEX_SKILLS_ROOT ?? path.join(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? '.', '.codex'), 'skills');
    const indexFile = process.env.CODEX_SKILL_WORKFLOW_INDEX ?? path.join(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? '.', '.codex'), 'skill-workflow-index.json');
    const result = await prepareWorkflow({ skillsRoot, indexFile, prompt, maxResults: Number(process.env.CODEX_SKILL_MAX_RESULTS ?? 3) });
    process.stdout.write(`${JSON.stringify({ indexFile, selected: result.selected.map(({ path: skillPath, name, route, reasons, readBeforeWork }) => ({ path: skillPath, name, route, reasons, readBeforeWork })) }, null, 2)}\n`);
    process.exit(0);
  }
  if (confirmFileIndex >= 0 || confirmIndex >= 0) {
    const confirmations = confirmFileIndex >= 0
      ? JSON.parse(await fs.readFile(process.argv[confirmFileIndex + 1], 'utf8'))
      : process.argv.slice(confirmIndex + 1).map((value) => {
          const [repo, ...paths] = value.split('::');
          return { repo, paths };
        });
    if (!Array.isArray(confirmations) || confirmations.some((item) => !item?.repo)) throw new Error('Confirmation input must be an array of {repo, paths}.');
    const installer = path.join(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? '.', '.codex'), 'skills', '.system', 'skill-installer', 'scripts', 'install-skill-from-github.py');
    const result = await installConfirmed({ stateFile, confirmations, installer });
    process.stdout.write(`${JSON.stringify({ ...result, workflowMappings: result.state.workflowMappings }, null, 2)}\n`);
    process.exit(0);
  }
  const result = await sync({
    stateFile,
    localDate,
    retryRateLimit: process.env.CODEX_SKILL_SYNC_RETRY === '1',
    fetchJson: () => github(apiUrl),
    inspectCandidate: async (item) => {
      const skill = await github(`https://api.github.com/repos/${item.full_name}/contents/SKILL.md`).catch(() => null);
      const commit = await github(`https://api.github.com/repos/${item.full_name}/commits/${item.default_branch}`).catch(() => null);
      return {
        skillPaths: (await github(`https://api.github.com/repos/${item.full_name}/git/trees/${item.default_branch}?recursive=1`).catch(() => ({ tree: [] }))).tree
          .filter((entry) => entry.type === 'blob' && (/^SKILL\.md$/.test(entry.path) || (/SKILL\.md$/.test(entry.path) && /(^|\/)(skills|\.claude\/skills|\.agents\/skills)\//.test(entry.path))))
          .map((entry) => entry.path),
        license: item.license?.spdx_id ?? item.license,
        commit: commit?.sha ?? null,
      };
    },
  });
  if (result.state?.topRepositories) {
    process.stdout.write(`${JSON.stringify({ ...result, candidatesForConfirmation: getInstallableCandidates(result.state).map(({ fullName, stars, defaultBranch, commit, skillPaths, license }) => ({ fullName, stars, defaultBranch, commit, skillPaths, license })) }, null, 2)}\n`);
  } else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
