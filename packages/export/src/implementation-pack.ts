import type { HypothesisCard, ImplementationFile, ImplementationPack } from "@conject/artifacts";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export function createScaffoldImplementationPack(runId: string, card: HypothesisCard): ImplementationPack {
  const rel = (name: string) => `implementations/${runId}/${card.id}/${name}`;
  const files: ImplementationFile[] = [
    {
      path: rel("README.md"),
      content: `# ${card.title}\n\n${card.hypothesis}\n\n## Validate\n\n\`\`\`bash\nuv sync\nuv run pytest\n\`\`\`\n`
    },
    {
      path: rel("PLAN.md"),
      content: `# Implementation Plan\n\n## Minimal Experiment\n${card.minimalExperiment}\n\n## Falsification Test\n${card.falsificationTest}\n`
    },
    {
      path: rel("pyproject.toml"),
      content: `[project]\nname = "${packageName(card.id)}"\nversion = "0.1.0"\nrequires-python = ">=3.11"\ndependencies = []\n\n[dependency-groups]\ndev = ["pytest>=8"]\n`
    },
    {
      path: rel("src/experiment.py"),
      content: `def run_experiment() -> dict[str, float]:\n    \"\"\"Replace this stub with the minimal experiment for ${card.id}.\"\"\"\n    return {\"baseline\": 0.0, \"candidate\": 0.0}\n\n\nif __name__ == \"__main__\":\n    print(run_experiment())\n`
    },
    {
      path: rel("tests/test_smoke.py"),
      content: `from src.experiment import run_experiment\n\n\ndef test_run_experiment_returns_metrics():\n    result = run_experiment()\n    assert \"baseline\" in result\n    assert \"candidate\" in result\n`
    }
  ];

  return {
    hypothesisId: card.id,
    planMarkdownPath: rel("PLAN.md"),
    generatedFiles: files.map((file) => file.path),
    runCommands: ["uv sync", "uv run pytest"],
    validationChecklist: ["Smoke test passes", "Baseline metric is implemented", "Candidate metric is implemented"],
    files
  };
}

export function materializeImplementationPack(
  cwd: string,
  runId: string,
  card: HypothesisCard,
  pack: ImplementationPack = createScaffoldImplementationPack(runId, card)
): ImplementationPack {
  const materializable = pack.files?.length ? pack : createScaffoldImplementationPack(runId, card);
  materializeImplementationPackFiles(cwd, materializable);
  return materializable;
}

export function materializeImplementationPackFiles(cwd: string, pack: ImplementationPack): void {
  if (!pack.files?.length) throw new Error("ImplementationPack has no files to materialize.");
  for (const file of pack.files) writePackFile(cwd, file);
}

function writePackFile(cwd: string, file: ImplementationFile): void {
  const target = resolve(cwd, file.path);
  const allowedRoot = resolve(cwd, "implementations");
  if (target !== allowedRoot && !target.startsWith(`${allowedRoot}${sep}`)) {
    throw new Error(`Refusing to write implementation file outside implementations/: ${file.path}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content, "utf8");
  if (file.executable) chmodSync(target, 0o755);
}

function packageName(id: string): string {
  return `conject-${id.toLowerCase()}`.replace(/[^a-z0-9-]/g, "-");
}
