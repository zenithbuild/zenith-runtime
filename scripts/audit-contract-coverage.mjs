import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const auditDir = path.join(repoRoot, 'audit-output');

function normalizeNewlines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function readUtf8(filePath) {
  return normalizeNewlines(readFileSync(filePath, 'utf8'));
}

function runCommand({ id, command, args }) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  const stdout = normalizeNewlines(result.stdout);
  const stderr = normalizeNewlines(result.stderr);
  const status = Number.isInteger(result.status) ? result.status : 1;

  const header = [`$ ${command} ${args.join(' ')}`, `exit=${status}`].join('\n');
  const body = [
    header,
    '--- stdout ---',
    stdout || '<empty>',
    '--- stderr ---',
    stderr || '<empty>'
  ].join('\n');

  process.stdout.write(`${body}\n`);

  return { id, command, args, status, stdout, stderr, body };
}

function extractFingerprints(sourceText) {
  const source = normalizeNewlines(sourceText);
  const fingerprints = new Set();

  function addIncludesFingerprint(rawToken) {
    const token = String(rawToken);
    fingerprints.add(`includes:${token}`);

    if (token.includes('requires params object')) {
      fingerprints.add('assert:regex:requires params object');
    }
    if (token.includes('requires ssr_data object')) {
      fingerprints.add('assert:regex:requires ssr_data object');
    }
    if (token.includes('signal table out of order')) {
      fingerprints.add('assert:regex:signal table out of order');
    }
    if (token.includes('signal index') && token.includes('did not resolve')) {
      fingerprints.add('assert:regex:signal index .* did not resolve');
    }
  }

  for (const match of source.matchAll(/includes\((['"`])((?:\\.|(?!\1).)*)\1\)/g)) {
    addIncludesFingerprint(match[2]);
  }

  for (const match of source.matchAll(
    /expect\([^)]*includes\((['"`])((?:\\.|(?!\1).)*)\1\)[^)]*\)\.toBe\((true|false)\)/g
  )) {
    fingerprints.add(`assert:includes:${match[2]}:${match[3]}`);
  }

  for (const match of source.matchAll(
    /assert\.equal\([^,]*includes\((['"`])((?:\\.|(?!\1).)*)\1\)\s*,\s*(true|false)/g
  )) {
    fingerprints.add(`assert:includes:${match[2]}:${match[3]}`);
  }

  for (const match of source.matchAll(/toThrow\(\s*\/([^/]+)\/[gimsuy]*\s*\)/g)) {
    fingerprints.add(`assert:regex:${match[1]}`);
  }

  if (source.includes('Object.keys(runtimeApi)')) {
    fingerprints.add('assert:runtime-api-keys:present');
  }

  if (
    /toEqual\(\s*\[\s*'hydrate'\s*,\s*'signal'\s*,\s*'state'\s*,\s*'zeneffect'\s*\]\s*\)/.test(
      source
    )
  ) {
    fingerprints.add('assert:runtime-api-keys:exact-hydrate-signal-state-zeneffect');
  }
  if (
    /assert\.deepEqual\(\s*runtimeApiKeys\s*,\s*\[\s*'hydrate'\s*,\s*'signal'\s*,\s*'state'\s*,\s*'zeneffect'\s*\]/.test(
      source
    )
  ) {
    fingerprints.add('assert:runtime-api-keys:exact-hydrate-signal-state-zeneffect');
  }

  if (
    /assert\.equal\(\s*sourceA\s*,\s*sourceB/.test(source) ||
    /expect\(\s*sourceA\s*\)\.toBe\(\s*sourceB\s*\)/.test(source)
  ) {
    fingerprints.add('assert:determinism:sourceA-equals-sourceB');
  }

  if (source.includes('goldenPath') || source.includes('.golden.')) {
    fingerprints.add('assert:determinism:golden-output');
  }

  if (source.includes("querySelectorAll('*')")) {
    fingerprints.add('assert:dom:no-full-tree-query');
  }

  if (source.includes('eval(')) {
    fingerprints.add('assert:forbidden:eval');
  }
  if (source.includes('new Function')) {
    fingerprints.add('assert:forbidden:new-function');
  }
  if (source.includes('process.env')) {
    fingerprints.add('assert:forbidden:process-env');
  }

  if (source.includes("'./template'") || source.includes('"./template"')) {
    fingerprints.add('assert:exports:template-subpath');
  }

  return [...fingerprints].sort();
}

function categorize(fingerprints) {
  const set = new Set(fingerprints);
  const has = (value) => set.has(value);
  const hasPrefix = (prefix) => [...set].some((item) => item.startsWith(prefix));

  return {
    determinism_bytes: has('assert:determinism:sourceA-equals-sourceB'),
    forbidden_dot_zen:
      has('assert:includes:.zen:false') || has('assert:includes:.zen imports:false'),
    forbidden_zenith: has('assert:includes:zenith::false'),
    forbidden_fetch: has('assert:includes:fetch(:false'),
    package_exports_template:
      has('assert:exports:template-subpath') || has('includes:./template'),
    golden_output_lock: has('assert:determinism:golden-output'),
    browser_global_tokens:
      has('assert:includes:window:false') ||
      has('assert:includes:document:false') ||
      has('assert:includes:navigator:false'),
    runtime_api_export_lock: has('assert:runtime-api-keys:exact-hydrate-signal-state-zeneffect'),
    forbidden_execution_primitives:
      has('assert:forbidden:eval') ||
      has('assert:forbidden:new-function') ||
      has('assert:forbidden:process-env'),
    no_full_tree_dom_discovery: has('assert:dom:no-full-tree-query')
  };
}

function detectFailedLegacyCategories(legacyOutput) {
  const text = `${legacyOutput.stdout}\n${legacyOutput.stderr}`;
  const failed = new Set();

  if (text.includes('runtime API lock') || text.includes('exports explicit hydration/reactivity functions')) {
    failed.add('runtime_api_export_lock');
  }
  if (text.includes('contains no forbidden execution primitives')) {
    failed.add('forbidden_execution_primitives');
  }
  if (text.includes('does not use full-tree DOM discovery')) {
    failed.add('no_full_tree_dom_discovery');
  }

  return failed;
}

function formatStatus(covered, suitePassed, categoryId, failedCategories = new Set()) {
  if (!covered) return 'N/A';
  if (!suitePassed) {
    if (failedCategories.has(categoryId)) return 'FAIL';
    return 'FAIL';
  }
  return 'PASS';
}

function writeFileNormalized(filePath, value) {
  writeFileSync(filePath, normalizeNewlines(value));
}

const contractPackCommands = [
  { id: 'dependency_contract', command: 'node', args: ['dependency_contract.spec.js'] },
  { id: 'contract_scan', command: 'node', args: ['contract-scan.mjs'] },
  { id: 'template_contract', command: 'node', args: ['template-contract.spec.js'] }
];

const legacyCommand = {
  id: 'legacy_integration',
  command: 'npm',
  args: ['run', 'test:legacy', '--silent']
};

mkdirSync(auditDir, { recursive: true });

const contractResults = [];
for (const command of contractPackCommands) {
  contractResults.push(runCommand(command));
}
const legacyResult = runCommand(legacyCommand);

const contractPackPassed = contractResults.every((result) => result.status === 0);
const legacyPassed = legacyResult.status === 0;

const contractPackLog = contractResults.map((result) => result.body).join('\n\n');
const legacyLog = legacyResult.body;

writeFileNormalized(path.join(auditDir, 'contract-pack.log'), contractPackLog);
writeFileNormalized(path.join(auditDir, 'legacy.log'), legacyLog);

const legacyFiles = [path.join(repoRoot, 'tests', 'integration.spec.js')];
const packFiles = [
  path.join(repoRoot, 'dependency_contract.spec.js'),
  path.join(repoRoot, 'contract-scan.mjs'),
  path.join(repoRoot, 'template-contract.spec.js')
];

const legacyFingerprints = legacyFiles
  .map((filePath) => extractFingerprints(readUtf8(filePath)))
  .flat();
const packFingerprints = packFiles
  .map((filePath) => extractFingerprints(readUtf8(filePath)))
  .flat();

const legacySet = new Set(legacyFingerprints);
const packSet = new Set(packFingerprints);
const overlap = [...legacySet].filter((item) => packSet.has(item)).sort();
const legacyOnly = [...legacySet].filter((item) => !packSet.has(item)).sort();
const packOnly = [...packSet].filter((item) => !legacySet.has(item)).sort();

const legacyCategories = categorize([...legacySet]);
const packCategories = categorize([...packSet]);
const failedLegacyCategories = detectFailedLegacyCategories(legacyResult);

const categoryRows = [
  { id: 'determinism_bytes', label: 'determinism bytes' },
  { id: 'forbidden_dot_zen', label: 'forbidden tokens (.zen)' },
  { id: 'forbidden_zenith', label: 'forbidden tokens (zenith:)' },
  { id: 'forbidden_fetch', label: 'forbidden tokens (fetch() )' },
  { id: 'package_exports_template', label: 'package exports ./template' },
  { id: 'golden_output_lock', label: 'golden output lock' },
  { id: 'browser_global_tokens', label: 'browser-global tokens' },
  { id: 'runtime_api_export_lock', label: 'runtime API export lock' },
  { id: 'forbidden_execution_primitives', label: 'forbidden execution primitives' },
  { id: 'no_full_tree_dom_discovery', label: 'no full-tree DOM discovery' }
];

const matrix = categoryRows.map((row) => ({
  category: row.label,
  legacy: formatStatus(legacyCategories[row.id], legacyPassed, row.id, failedLegacyCategories),
  contract_pack: formatStatus(packCategories[row.id], contractPackPassed, row.id),
  notes:
    legacyCategories[row.id] && packCategories[row.id]
      ? 'covered by both suites'
      : legacyCategories[row.id]
        ? 'legacy-only coverage'
        : packCategories[row.id]
          ? 'contract-pack-only coverage'
          : 'not asserted'
}));

const legacyOnlyRuntimeSpecific = legacyOnly.filter((fingerprint) => {
  return (
    fingerprint.includes('runtime-api') ||
    fingerprint.includes('forbidden:new-function') ||
    fingerprint.includes('forbidden:eval') ||
    fingerprint.includes('forbidden:process-env') ||
    fingerprint.includes('dom:no-full-tree') ||
    fingerprint.includes('assert:regex:signal index') ||
    fingerprint.includes('assert:regex:requires params object') ||
    fingerprint.includes('assert:regex:requires ssr_data object')
  );
});

const recommendation = legacyOnlyRuntimeSpecific.length > 0 ? 'Option B' : 'Option A';
const recommendationReason =
  recommendation === 'Option B'
    ? 'Legacy tests contain runtime-specific assertions not fully enforced by the contract pack.'
    : 'Legacy assertions are fully covered by the contract pack (or by cross-repo contracts).';

const summary = {
  recommendation,
  reason: recommendationReason,
  command_status: {
    contract_pack: contractPackPassed ? 'PASS' : 'FAIL',
    legacy: legacyPassed ? 'PASS' : 'FAIL'
  },
  counts: {
    legacy_total: legacySet.size,
    contract_pack_total: packSet.size,
    overlap: overlap.length,
    legacy_only: legacyOnly.length,
    pack_only: packOnly.length
  },
  matrix,
  overlap_fingerprints: overlap,
  legacy_only_fingerprints: legacyOnly,
  pack_only_fingerprints: packOnly,
  legacy_only_runtime_specific: legacyOnlyRuntimeSpecific
};

writeFileNormalized(path.join(auditDir, 'audit.json'), JSON.stringify(summary, null, 2));

const matrixLines = [
  'CATEGORY | LEGACY | CONTRACT_PACK | NOTES',
  '-----------------------------------------',
  ...matrix.map(
    (row) => `${row.category} | ${row.legacy} | ${row.contract_pack} | ${row.notes}`
  )
];

const humanSummary = [
  ...matrixLines,
  '',
  `Legacy-only fingerprints (${legacyOnly.length}):`,
  ...legacyOnly.map((item) => `- ${item}`),
  '',
  `Pack-only fingerprints (${packOnly.length}):`,
  ...packOnly.map((item) => `- ${item}`),
  '',
  `RECOMMENDATION: ${recommendation}`,
  `REASON: ${recommendationReason}`,
  `EVIDENCE: legacy_only=${legacyOnly.length}, overlap=${overlap.length}, pack_only=${packOnly.length}`,
  'Top 10 legacy-only fingerprints:',
  ...legacyOnly.slice(0, 10).map((item) => `- ${item}`)
].join('\n');

writeFileNormalized(path.join(auditDir, 'audit.txt'), humanSummary);
process.stdout.write(`${humanSummary}\n`);
