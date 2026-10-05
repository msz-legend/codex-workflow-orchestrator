# Codex Workflow Orchestrator

An Agent Skill that routes Codex tasks to the smallest useful workflow, selects relevant skills, and verifies the result before reporting completion.

## Install

Install from this repository with the Skills CLI:

```bash
npx skills add msz-legend/codex-workflow-orchestrator
```

The skill is provided in `SKILL.md` and is compatible with Codex-style skills directories.

## Use

Once installed, ask Codex to handle a task normally. The skill is selected when the task benefits from workflow classification and coordinated skill selection.

## Daily discovery

On the first session request of each local calendar day, the skill queries GitHub for the ten highest-Star public Skill repositories, compares them with local Skills, and presents validated missing candidates for explicit confirmation. Confirmed candidates are installed and mapped into the workflow. Later requests that day reuse the cached result.

The sync records repository URLs, Star counts, commit identifiers, hashes, installation attempts, and route mappings. Star count is only a discovery signal: invalid metadata, missing `SKILL.md`, unclear provenance, or unacceptable licensing causes a candidate to be skipped.

Downloaded content is treated as untrusted. The skill does not execute third-party scripts, expose credentials, upload user files, or allow a downloaded Skill to weaken safety and verification rules. If GitHub is unavailable or local state cannot be written safely, it uses the original local workflow and does not retry that day.

## License

No license has been selected yet. Add a license before redistributing this skill under specific terms.
