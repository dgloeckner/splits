#!/usr/bin/env node
// Regression test for the e2e-critic sub-agent.
//
// Feeds the canonical empty-canvas PNG + a representative AC list to the
// critic and asserts:
//   1. exit code is non-zero
//   2. stdout is valid JSON
//   3. findings[] contains a severity: "blocker" entry that references
//      the missing boat / empty canvas
//
// The sub-agent is invoked through the Claude Code CLI:
//
//   claude -p --agent e2e-critic < input.json
//
// If the CLI is not available, the test SKIPs with a TODO rather than
// failing. PRD-0016 §Implementation Decisions describes the per-slice
// gate invocation; the exact wiring may change as 0016-04+ land.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const emptyCanvas = join(__dirname, 'empty-canvas.png');

if (!existsSync(emptyCanvas)) {
  console.error(`FAIL: fixture missing: ${emptyCanvas}`);
  console.error(`run: node ${join(__dirname, 'make-fixtures.mjs')}`);
  process.exit(1);
}

const criticInput = {
  scenario_name: 'race-happy-path-regression',
  ac_list: [
    'AC1: The user boat is visible at the start line before GO!',
    'AC2: The race canvas shows lane markings throughout the race',
    'AC3: The stat bar at the top remains visible across all phases',
  ],
  screens: [
    {
      step_id: '02-attention',
      screenshot_path: emptyCanvas,
      description:
        'During ATTENTION (1500 ms after Bereit). The user boat should be visible at the start line and lane markings should be drawn on the canvas.',
    },
  ],
};

// Locate the claude CLI.
const which = spawnSync('which', ['claude'], { encoding: 'utf8' });
if (which.status !== 0 || !which.stdout.trim()) {
  console.log(
    'SKIP: claude CLI not on PATH. TODO: invoke the e2e-critic sub-agent through whichever mechanism the AFK loop standardises on (see PRD-0016). For now, this regression test is gated on having `claude` available.',
  );
  process.exit(0);
}

console.log('Invoking e2e-critic via: claude -p --agent e2e-critic');

const prompt = [
  'You are being invoked as the e2e-critic sub-agent. The following JSON is your input contract payload. Read each screenshot via the Read tool and emit exactly one JSON document to stdout matching the schema in your sub-agent definition. Exit non-zero iff any finding has severity "blocker".',
  '',
  'INPUT:',
  JSON.stringify(criticInput, null, 2),
].join('\n');

const result = spawnSync(
  'claude',
  ['-p', '--agent', 'e2e-critic', '--permission-mode', 'bypassPermissions', prompt],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5 * 60_000,
  },
);

if (result.error) {
  console.log(`SKIP: failed to spawn claude CLI: ${result.error.message}`);
  console.log('TODO: confirm the invocation mechanism the AFK loop uses for sub-agents and update this test.');
  process.exit(0);
}

const stdout = result.stdout || '';
const stderr = result.stderr || '';
const exitCode = result.status;

console.log('--- critic stdout ---');
console.log(stdout);
console.log('--- critic stderr ---');
console.log(stderr);
console.log(`--- critic exit code: ${exitCode} ---`);

// Try to extract the JSON. The model may wrap it in prose despite the
// hard rule; pull out the first {...} balanced block as a fallback.
function extractJson(s) {
  const trimmed = s.trim();
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const parsed = extractJson(stdout);
const failures = [];

if (!parsed || !Array.isArray(parsed.findings)) {
  failures.push('stdout is not parseable as { findings: [...] }');
}

const findings = parsed && Array.isArray(parsed.findings) ? parsed.findings : [];
const blockers = findings.filter((f) => f && f.severity === 'blocker');

if (blockers.length === 0) {
  failures.push('expected at least one severity: "blocker" finding');
}

const missingBoatKeywords = /\b(boat|canvas|empty|missing|blank|not visible|absent|void)\b/i;
const referencesMissingBoat = blockers.some((f) => {
  const text = `${f.summary || ''}\n${f.detail || ''}`;
  return missingBoatKeywords.test(text);
});

if (!referencesMissingBoat) {
  failures.push('no blocker finding mentions the missing boat / empty canvas');
}

if (exitCode === 0) {
  failures.push(`expected non-zero exit code; got ${exitCode}`);
}

if (failures.length) {
  console.error('FAIL:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('PASS: e2e-critic flagged the empty-canvas regression');
process.exit(0);
