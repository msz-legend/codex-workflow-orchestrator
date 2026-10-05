import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildWorkflowIndex, createState, getInstallableCandidates, installConfirmed, selectSkillsForPrompt, selectConfirmedCandidates, shouldSync, suggestWorkflowMappings, sync, validateCandidate, writeState } from '../scripts/skill-sync.mjs';

test('missing state triggers synchronization', async () => {
  assert.equal(await shouldSync(path.join(os.tmpdir(), `missing-${Date.now()}.json`), '2026-10-05'), true);
});

test('completed state for today does not synchronize again', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const file = path.join(dir, 'state.json');
  await writeState(file, createState('2026-10-05', { syncCompleted: true }));
  assert.equal(await shouldSync(file, '2026-10-05'), false);
});

test('failed state for today also prevents repeated network requests', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const file = path.join(dir, 'state.json');
  await writeState(file, createState('2026-10-05', { syncCompleted: false, failure: 'network' }));
  assert.equal(await shouldSync(file, '2026-10-05'), false);
});

test('candidate validation requires a Skill file and license', () => {
  assert.equal(validateCandidate({ fullName: 'owner/repo', htmlUrl: 'https://github.com/owner/repo', defaultBranch: 'main', skillPaths: ['skills/example/SKILL.md'], license: 'MIT' }).valid, true);
  assert.equal(validateCandidate({ fullName: 'owner/repo', htmlUrl: 'https://github.com/owner/repo', defaultBranch: 'main', skillPaths: [], license: 'MIT' }).valid, false);
});

test('first sync records validated candidates and does not install by default', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const file = path.join(dir, 'state.json');
  const result = await sync({
    stateFile: file,
    localDate: '2026-10-05',
    fetchJson: async () => ({ items: [{ full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', owner: { login: 'owner' }, stargazers_count: 10, default_branch: 'main' }] }),
    inspectCandidate: async () => ({ commit: 'abc', skillPaths: ['skills/example/SKILL.md'], license: 'MIT' }),
  });
  assert.equal(result.state.syncCompleted, true);
  assert.equal(result.state.topRepositories[0].validation, 'accepted');
  assert.deepEqual(result.state.topRepositories[0].skillPaths, ['skills/example/SKILL.md']);
  assert.deepEqual(result.state.installedCandidates, []);
});

test('same-day state skips the network callback', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const file = path.join(dir, 'state.json');
  await writeState(file, createState('2026-10-05', { syncCompleted: true }));
  let called = false;
  const result = await sync({ stateFile: file, localDate: '2026-10-05', fetchJson: async () => { called = true; return { items: [] }; } });
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});

test('inspection rate limits are inconclusive, not a missing Skill file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const file = path.join(dir, 'state.json');
  const result = await sync({
    stateFile: file,
    localDate: '2026-10-05',
    fetchJson: async () => ({ items: [{ full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', owner: { login: 'owner' }, stargazers_count: 10, default_branch: 'main' }] }),
    inspectCandidate: async () => { throw Object.assign(new Error('rate limited'), { rateLimited: true, status: 403 }); },
  });
  assert.equal(result.state.topRepositories[0].validation, 'inconclusive: GitHub API rate limit');
  assert.equal(result.state.topRepositories[0].rateLimited, true);
  assert.equal(result.state.syncCompleted, false);
  assert.equal(result.state.rateLimited, true);
});

test('rate-limited state can be retried explicitly', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const file = path.join(dir, 'state.json');
  await writeState(file, createState('2026-10-05', { syncCompleted: false, rateLimited: true }));
  let called = false;
  const result = await sync({ stateFile: file, localDate: '2026-10-05', retryRateLimit: true, fetchJson: async () => { called = true; return { items: [] }; } });
  assert.equal(result.skipped, false);
  assert.equal(called, true);
});

test('only validated candidates and validated paths can be confirmed', async () => {
  const state = createState('2026-10-05', { topRepositories: [
    { fullName: 'owner/repo', defaultBranch: 'main', validation: 'accepted', skillPaths: ['skills/a/SKILL.md'] },
    { fullName: 'owner/nope', validation: 'missing', skillPaths: ['skills/b/SKILL.md'] },
  ] });
  assert.equal(getInstallableCandidates(state).length, 1);
  assert.deepEqual(selectConfirmedCandidates(state, [{ repo: 'owner/repo', paths: ['skills/a/SKILL.md'] }])[0].paths, ['skills/a/SKILL.md']);
  assert.throws(() => selectConfirmedCandidates(state, [{ repo: 'owner/nope' }]));
  assert.throws(() => selectConfirmedCandidates(state, [{ repo: 'owner/repo', paths: ['skills/other/SKILL.md'] }]));
});

test('confirmation supports multiple paths in one repository', () => {
  const state = createState('2026-10-05', { topRepositories: [{ fullName: 'owner/repo', defaultBranch: 'main', validation: 'accepted', skillPaths: ['skills/a/SKILL.md', 'skills/b/SKILL.md'] }] });
  assert.deepEqual(selectConfirmedCandidates(state, [{ repo: 'owner/repo', paths: ['skills/a/SKILL.md', 'skills/b/SKILL.md'] }])[0].paths, ['skills/a/SKILL.md', 'skills/b/SKILL.md']);
});

test('confirmed skills receive conservative workflow mapping suggestions', () => {
  assert.equal(suggestWorkflowMappings(['skills/research/SKILL.md'])[0].route, 'Research or competitive analysis');
  assert.equal(suggestWorkflowMappings(['skills/code-review/SKILL.md'])[0].route, 'Code review');
  assert.equal(suggestWorkflowMappings(['skills/test-driven-development/SKILL.md'])[0].route, 'Bug investigation');
});

test('existing destination is preserved during confirmation install', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const stateFile = path.join(dir, 'state.json');
  const destination = path.join(dir, 'skills');
  await fs.mkdir(path.join(destination, 'example'), { recursive: true });
  await writeState(stateFile, createState('2026-10-05', { topRepositories: [{ fullName: 'owner/repo', defaultBranch: 'main', commit: 'abc', validation: 'accepted', skillPaths: ['skills/example/SKILL.md'] }] }));
  const result = await installConfirmed({ stateFile, destination, confirmations: [{ repo: 'owner/repo' }], installer: 'unused', python: 'unused' });
  assert.equal(result.installed[0].status, 'already-installed');
  assert.equal(result.state.installedCandidates[0].results[0].status, 'already-installed');
});

test('installer receives Skill directories instead of SKILL.md files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const stateFile = path.join(dir, 'state.json');
  const destination = path.join(dir, 'skills');
  await fs.mkdir(path.join(destination, 'example'), { recursive: true });
  await writeState(stateFile, createState('2026-10-05', { topRepositories: [{ fullName: 'owner/repo', defaultBranch: 'main', commit: 'abc', validation: 'accepted', skillPaths: ['skills/example/SKILL.md'] }] }));
  const result = await installConfirmed({ stateFile, destination, confirmations: [{ repo: 'owner/repo' }], installer: 'unused', python: 'unused' });
  assert.equal(result.installed[0].status, 'already-installed');
  assert.equal(result.installed[0].results[0].skillPath, 'skills/example');
});

test('workflow index discovers Skill metadata and route', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const skillsRoot = path.join(dir, 'skills');
  const indexFile = path.join(dir, 'skill-workflow-index.json');
  await fs.mkdir(path.join(skillsRoot, 'research-helper'), { recursive: true });
  await fs.writeFile(path.join(skillsRoot, 'research-helper', 'SKILL.md'), '---\nname: research-helper\ndescription: Use when researching public sources\n---\n# Research helper\n', 'utf8');
  const index = await buildWorkflowIndex({ skillsRoot, indexFile, sourceBySkill: { 'research-helper': 'owner/repo@abc' } });
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].route, 'Research or competitive analysis');
  assert.equal(index.skills[0].source, 'owner/repo@abc');
});

test('workflow index preserves existing source provenance on rebuild', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const skillsRoot = path.join(dir, 'skills');
  const indexFile = path.join(dir, 'skill-workflow-index.json');
  await fs.mkdir(path.join(skillsRoot, 'research-helper'), { recursive: true });
  await fs.writeFile(path.join(skillsRoot, 'research-helper', 'SKILL.md'), '---\nname: research-helper\ndescription: Use when researching public sources\n---\n', 'utf8');
  await buildWorkflowIndex({ skillsRoot, indexFile, sourceBySkill: { 'research-helper': 'owner/repo@abc' } });
  const rebuilt = await buildWorkflowIndex({ skillsRoot, indexFile });
  assert.equal(rebuilt.skills[0].source, 'owner/repo@abc');
});

test('prompt selection returns relevant Skill paths and reasons', () => {
  const index = { skills: [
    { name: 'research-helper', description: 'Use when researching public sources', route: 'Research or competitive analysis', path: 'C:/skills/research-helper/SKILL.md', keywords: ['research', 'public', 'sources'] },
    { name: 'code-review', description: 'Review code changes', route: 'Code review', path: 'C:/skills/code-review/SKILL.md', keywords: ['review', 'code', 'changes'] },
  ] };
  const selected = selectSkillsForPrompt(index, '请帮我 research public sources', { maxResults: 2 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].name, 'research-helper');
  assert.ok(selected[0].reasons.length > 0);
  assert.equal(selected[0].readBeforeWork, true);
});

test('prompt selection filters incidental one-word matches', () => {
  const index = { skills: [
    { name: 'agent-transcript', description: 'GitHub transcript utility', route: 'General workflow', path: 'C:/skills/agent-transcript/SKILL.md', keywords: ['github'] },
    { name: 'research-helper', description: 'Research public sources', route: 'Research or competitive analysis', path: 'C:/skills/research-helper/SKILL.md', keywords: ['research', 'public', 'sources'] },
  ] };
  const selected = selectSkillsForPrompt(index, 'research public sources on GitHub');
  assert.deepEqual(selected.map((skill) => skill.name), ['research-helper']);
});

test('prompt selection supports Chinese workflow terms', () => {
  const index = { skills: [
    { name: 'research', description: 'Research public sources', route: 'Research or competitive analysis', path: 'C:/skills/research/SKILL.md', keywords: ['research', '研究', '资料'] },
    { name: 'code-review', description: 'Review code changes', route: 'Code review', path: 'C:/skills/code-review/SKILL.md', keywords: ['review', '代码', '审查'] },
  ] };
  const selected = selectSkillsForPrompt(index, '请研究资料并审查代码');
  assert.deepEqual(selected.map((skill) => skill.name), ['code-review', 'research']);
});

test('prepareWorkflow rebuilds the index and selects Skills for a request', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-sync-'));
  const skillsRoot = path.join(dir, 'skills');
  const indexFile = path.join(dir, 'index.json');
  await fs.mkdir(path.join(skillsRoot, 'code-review'), { recursive: true });
  await fs.writeFile(path.join(skillsRoot, 'code-review', 'SKILL.md'), '---\nname: code-review\ndescription: Review code changes\n---\n', 'utf8');
  const { selected } = await (await import('../scripts/skill-sync.mjs')).prepareWorkflow({ skillsRoot, indexFile, prompt: 'review code changes' });
  assert.equal(selected[0].name, 'code-review');
  assert.equal(selected[0].readBeforeWork, true);
});
