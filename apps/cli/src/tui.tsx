import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Artifact, HypothesisCard, Job, Run } from "@conject/artifacts";
import { createConjectController, type ConjectController, type ProjectSnapshot, type RunDetail } from "./controller.js";
import { parseSlashCommand, type SlashCommand } from "./slash-commands.js";
import { openBrowser } from "./ui-oauth.js";

type Mode = "dashboard" | "new-run" | "command";

export async function runTui(cwd = process.cwd()): Promise<void> {
  const instance = render(<ConjectTui controller={createConjectController(cwd)} />);
  await instance.waitUntilExit();
}

export function ConjectTui({ controller }: { controller: ConjectController }): React.ReactElement {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>({ cwd: controller.cwd, hasConfig: controller.hasConfig, runs: [] });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detail, setDetail] = useState<RunDetail | undefined>();
  const [mode, setMode] = useState<Mode>("dashboard");
  const [prompt, setPrompt] = useState("");
  const [commandInput, setCommandInput] = useState("/");
  const [message, setMessage] = useState("Loading project...");
  const [busy, setBusy] = useState<string | undefined>();

  const selectedRun = snapshot.runs[selectedIndex];

  const refresh = useCallback(async () => {
    const next = await controller.snapshot();
    setSnapshot(next);
    setSelectedIndex((index) => clamp(index, 0, Math.max(0, next.runs.length - 1)));
    const run = next.runs[clamp(selectedIndex, 0, Math.max(0, next.runs.length - 1))];
    if (run) setDetail(await controller.getRunDetail(run.id));
    else setDetail(undefined);
    if (!next.hasConfig) setMessage("No conject.yaml. Press i to initialize.");
    else if (next.configError) setMessage(next.configError);
    else setMessage("Ready.");
  }, [controller, selectedIndex]);

  const refreshSelected = useCallback(
    async (run?: Run) => {
      const target = run ?? selectedRun;
      if (!target) {
        setDetail(undefined);
        return;
      }
      setDetail(await controller.getRunDetail(target.id));
    },
    [controller, selectedRun]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      void refreshSelected();
    }, 1000);
    return () => clearInterval(timer);
  }, [busy, refreshSelected]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<string | void>) => {
      setBusy(label);
      setMessage(label);
      try {
        const result = await action();
        setMessage(result || `${label} complete.`);
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(undefined);
      }
    },
    [refresh]
  );

  const topHypothesisId = useMemo(() => {
    const first = detail?.ranking?.items?.[0]?.hypothesisId;
    if (first) return first;
    const card = detail?.artifacts.find((artifact) => artifact.type === "hypothesis_card")?.json as HypothesisCard | undefined;
    return card?.id;
  }, [detail]);

  const login = useCallback(
    async () => {
      const next = await controller.authLogin({
        onAuth: (info) => {
          setMessage("Complete Conject auth in the browser.");
          openBrowser(info.url);
        },
        onDeviceCode: (info) => setMessage(`Open ${info.verificationUri} and enter ${info.userCode}.`),
        onPrompt: async () => {
          throw new Error("Browser callback did not complete. Use: conject auth login --manual");
        },
        onProgress: setMessage,
        onSelect: async () => undefined
      });
      return `Conject auth ready: ${next.ready ? "yes" : "no"}`;
    },
    [controller]
  );

  const executeSlashCommand = useCallback(
    async (command: SlashCommand) => {
      if (command.type === "help") {
        setMessage("Commands: /login, /logout, /status, /new <prompt>, /run, /export, /implement <hypothesis-id>.");
        return;
      }
      if (command.type === "status") {
        setMessage(formatStatusMessage(snapshot, selectedRun, detail));
        return;
      }
      if (command.type === "login") {
        await runAction("Starting Conject auth login", login);
        return;
      }
      if (command.type === "logout") {
        await runAction("Logging out Conject auth", async () => {
          const next = controller.authLogout();
          return `Conject auth ready: ${next.ready ? "yes" : "no"}`;
        });
        return;
      }
      if (command.type === "new") {
        if (!snapshot.hasConfig) throw new Error("Initialize first with i.");
        await runAction("Creating run", async () => {
          const run = await controller.createRun(command.prompt);
          setSelectedIndex(0);
          return `Created ${run.id}`;
        });
        return;
      }
      if (!selectedRun) throw new Error("No run selected.");
      if (command.type === "run") {
        await runAction(`Running ${selectedRun.id} with Pi`, () => controller.runPipeline(selectedRun.id));
        return;
      }
      if (command.type === "export") {
        await runAction(`Exporting ${selectedRun.id}`, () => controller.exportRun(selectedRun.id));
        return;
      }
      if (command.type === "implement") {
        await runAction(`Building ${command.hypothesisId}`, () => controller.implement(selectedRun.id, command.hypothesisId));
      }
    },
    [controller, detail, login, runAction, selectedRun, snapshot]
  );

  useInput((input, key) => {
    if (mode === "new-run" || mode === "command") {
      if (key.escape) {
        setMode("dashboard");
        setPrompt("");
        setCommandInput("/");
      }
      return;
    }
    if (busy) return;
    if (input === "q") exit();
    else if (input === "i") {
      if (snapshot.hasConfig) {
        setMessage("conject.yaml already exists.");
        return;
      }
      const path = controller.init("balanced");
      setMessage(`Wrote ${path}`);
      void refresh();
    } else if (input === "j" || key.downArrow) {
      setSelectedIndex((index) => clamp(index + 1, 0, Math.max(0, snapshot.runs.length - 1)));
    } else if (input === "k" || key.upArrow) {
      setSelectedIndex((index) => clamp(index - 1, 0, Math.max(0, snapshot.runs.length - 1)));
    } else if (input === "n") {
      if (!snapshot.hasConfig) setMessage("Initialize first with i.");
      else setMode("new-run");
    } else if (input === "/") {
      setCommandInput("/");
      setMode("command");
    } else if (input === "r" && selectedRun) {
      void runAction(`Running ${selectedRun.id} with Pi`, () => controller.runPipeline(selectedRun.id));
    } else if (input === "x" && selectedRun) {
      void runAction(`Exporting ${selectedRun.id}`, () => controller.exportRun(selectedRun.id));
    } else if (input === "b" && selectedRun) {
      if (!topHypothesisId) setMessage("No hypothesis available. Run the pipeline first.");
      else void runAction(`Building ${topHypothesisId}`, () => controller.implement(selectedRun.id, topHypothesisId));
    } else if (input === "l") {
      void runAction("Starting Conject auth login", login);
    } else if (input === "o") {
      void runAction("Logging out Conject auth", async () => {
        const next = controller.authLogout();
        return `Conject auth ready: ${next.ready ? "yes" : "no"}`;
      });
    } else if (input === "?") {
      setMessage("Keys: / command, n new, r run Pi, x export, b build, l login, o logout, q quit.");
    }
  });

  const submitPrompt = async (value: string): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setMode("dashboard");
    setPrompt("");
    await runAction("Creating run", async () => {
      const run = await controller.createRun(trimmed);
      setSelectedIndex(0);
      return `Created ${run.id}`;
    });
  };

  const submitCommand = async (value: string): Promise<void> => {
    setMode("dashboard");
    setCommandInput("/");
    const trimmed = value.trim();
    if (!trimmed || trimmed === "/") return;
    try {
      await executeSlashCommand(parseSlashCommand(trimmed));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header snapshot={snapshot} busy={busy} />
      {snapshot.configError ? <Text color="red">{snapshot.configError}</Text> : null}
      {!snapshot.hasConfig ? (
        <SetupScreen />
      ) : (
        <Box gap={2}>
          <RunsPane runs={snapshot.runs} selectedIndex={selectedIndex} />
          <DetailPane detail={detail} selectedRun={selectedRun} />
        </Box>
      )}
      {mode === "new-run" ? (
        <Box marginTop={1}>
          <Text color="cyan">New run prompt: </Text>
          <TextInput value={prompt} onChange={setPrompt} onSubmit={(value) => void submitPrompt(value)} />
        </Box>
      ) : mode === "command" ? (
        <Box marginTop={1}>
          <Text color="cyan">Command: </Text>
          <TextInput value={commandInput} onChange={setCommandInput} onSubmit={(value) => void submitCommand(value)} />
        </Box>
      ) : (
        <Footer message={message} />
      )}
    </Box>
  );
}

function Header({ snapshot, busy }: { snapshot: ProjectSnapshot; busy?: string }): React.ReactElement {
  const auth = snapshot.auth ? `${snapshot.auth.ready ? "ready" : "missing"} ${snapshot.auth.storagePath ?? ""}` : "unavailable";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Conject</Text>
      <Text color="gray">
        {snapshot.cwd} | config {snapshot.hasConfig ? "ready" : "missing"} | auth {auth}
      </Text>
      {busy ? <Text color="yellow">{busy}</Text> : null}
    </Box>
  );
}

function SetupScreen(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text>No conject.yaml found.</Text>
      <Text color="cyan">Press i to initialize a balanced Conject project.</Text>
      <Text color="gray">Press q to quit.</Text>
    </Box>
  );
}

function RunsPane({ runs, selectedIndex }: { runs: Run[]; selectedIndex: number }): React.ReactElement {
  return (
    <Box flexDirection="column" width={42}>
      <Text bold>Runs</Text>
      {runs.length === 0 ? <Text color="gray">No runs. Press n to create one.</Text> : null}
      {runs.slice(0, 14).map((run, index) => (
        <Text key={run.id} color={index === selectedIndex ? "cyan" : undefined}>
          {index === selectedIndex ? ">" : " "} {run.status.padEnd(9)} {run.title.slice(0, 24)}
        </Text>
      ))}
    </Box>
  );
}

function DetailPane({ detail, selectedRun }: { detail?: RunDetail; selectedRun?: Run }): React.ReactElement {
  if (!selectedRun) {
    return (
      <Box flexDirection="column">
        <Text bold>Dashboard</Text>
        <Text color="gray">Press n to create a run.</Text>
      </Box>
    );
  }
  const counts = countArtifacts(detail?.artifacts ?? []);
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold>{selectedRun.title}</Text>
      <Text color="gray">{selectedRun.id} | {selectedRun.status} | {selectedRun.createdAt}</Text>
      <Text>
        Jobs: {formatJobCounts(detail?.jobs ?? [])} | Artifacts: {Object.entries(counts).map(([type, count]) => `${type}:${count}`).join(" ")}
      </Text>
      <RankingSummary detail={detail} />
      <EventsSummary detail={detail} />
    </Box>
  );
}

function RankingSummary({ detail }: { detail?: RunDetail }): React.ReactElement {
  const items = detail?.ranking?.items ?? [];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Ranking</Text>
      {items.length === 0 ? <Text color="gray">No ranking yet.</Text> : null}
      {items.slice(0, 5).map((item) => (
        <Text key={item.hypothesisId}>
          {item.rank}. {item.hypothesisId} score={item.finalScore} {item.recommendation} - {item.explanation.slice(0, 72)}
        </Text>
      ))}
    </Box>
  );
}

function EventsSummary({ detail }: { detail?: RunDetail }): React.ReactElement {
  const events = detail?.events.slice(-5) ?? [];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Recent Events</Text>
      {events.length === 0 ? <Text color="gray">No events yet.</Text> : null}
      {events.map((event) => (
        <Text key={event.id} color="gray">
          {event.createdAt.slice(11, 19)} {event.type}
        </Text>
      ))}
    </Box>
  );
}

function Footer({ message }: { message: string }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">/ command | n new | r run Pi | x export | b build | l login | o logout | ? help | q quit</Text>
      <Text>{message}</Text>
    </Box>
  );
}

function countArtifacts(artifacts: Artifact[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const artifact of artifacts) counts[artifact.type] = (counts[artifact.type] ?? 0) + 1;
  return counts;
}

function formatJobCounts(jobs: Job[]): string {
  if (jobs.length === 0) return "none";
  const counts: Record<string, number> = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return Object.entries(counts)
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");
}

function formatStatusMessage(snapshot: ProjectSnapshot, selectedRun?: Run, detail?: RunDetail): string {
  const auth = snapshot.auth ? (snapshot.auth.ready ? "auth ready" : "auth missing") : "auth unavailable";
  const project = snapshot.hasConfig ? "config ready" : "config missing";
  if (!selectedRun) return `${project}; ${auth}; no run selected.`;
  return `${project}; ${auth}; selected ${selectedRun.id} ${selectedRun.status}; jobs ${formatJobCounts(detail?.jobs ?? [])}; artifacts ${
    Object.entries(countArtifacts(detail?.artifacts ?? []))
      .map(([type, count]) => `${type}:${count}`)
      .join(" ") || "none"
  }.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
