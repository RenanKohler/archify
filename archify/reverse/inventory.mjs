// Phase 0 — bounded repository inventory.
//
// Discovery is top-down and bounded: the tracked file list is classified into
// manifests, entrypoints, infrastructure, CI, configuration, and documentation
// before any architectural claim is written. Nothing here infers behavior; it
// only records what exists, so later phases start from a measured surface
// instead of a guess.

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'vendor',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  '__pycache__',
]);

// bin/ and obj/ are build output in .NET repositories and first-class source
// elsewhere, so they are ignored only when the repository actually builds .NET.
const DOTNET_OUTPUT = new Set(['bin', 'obj']);

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'composer.lock',
]);

const MANIFESTS = [
  /^package\.json$/,
  /\.(?:csproj|fsproj|vbproj|sln)$/,
  /^pom\.xml$/,
  /^build\.gradle(?:\.kts)?$/,
  /^settings\.gradle(?:\.kts)?$/,
  /^go\.mod$/,
  /^Cargo\.toml$/,
  /^pyproject\.toml$/,
  /^requirements(?:-[\w.]+)?\.txt$/,
  /^Gemfile$/,
  /^composer\.json$/,
  /^mix\.exs$/,
  /^deno\.json[c]?$/,
];

const ENTRYPOINTS = [
  /^Program\.cs$/,
  /^Startup\.cs$/,
  /^main\.(?:go|rs|py|ts|js|mjs|java|kt|c|cpp)$/,
  /^index\.(?:ts|js|mjs|cjs|tsx)$/,
  /^app\.(?:py|ts|js|mjs)$/,
  /^server\.(?:ts|js|mjs)$/,
  /^manage\.py$/,
  /^wsgi\.py$/,
  /^asgi\.py$/,
  /^Application(?:\w+)?\.java$/,
];

const INFRASTRUCTURE = [
  /^Dockerfile(?:\..+)?$/,
  /^docker-compose(?:\..+)?\.ya?ml$/,
  /^Procfile$/,
  /^vercel\.json$/,
  /^netlify\.toml$/,
  /^serverless\.ya?ml$/,
  /\.tf$/,
  /\.tfvars$/,
  /^Chart\.ya?ml$/,
  /^values(?:-[\w.]+)?\.ya?ml$/,
  /^skaffold\.ya?ml$/,
];

const INFRASTRUCTURE_DIRECTORIES = ['helm/', 'k8s/', 'kubernetes/', 'terraform/', 'deploy/', 'infra/', 'charts/'];

const CI = [
  /^\.github\/workflows\//,
  /^\.gitlab-ci\.ya?ml$/,
  /^azure-pipelines(?:\..+)?\.ya?ml$/,
  /^Jenkinsfile$/,
  /^\.circleci\//,
  /^\.travis\.ya?ml$/,
  /^buildkite\.ya?ml$/,
];

const CONFIGURATION = [
  /^application(?:-[\w.]+)?\.(?:ya?ml|properties)$/,
  /^appsettings(?:\.[\w.]+)?\.json$/,
  /^\.env\.example$/,
  /^\.env\.sample$/,
  /^config(?:\.[\w.]+)?\.(?:ya?ml|json|toml)$/,
  /^tsconfig(?:\.[\w.]+)?\.json$/,
];

const DOCUMENTATION = [
  /^README(?:_[A-Z]{2})?\.md$/i,
  /^CONTRIBUTING\.md$/i,
  /^ARCHITECTURE\.md$/i,
  /^DESIGN\.md$/i,
  /^CHANGELOG\.md$/i,
  /^docs\//,
];

const LANGUAGES = new Map(Object.entries({
  '.cs': 'C#',
  '.fs': 'F#',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.go': 'Go',
  '.rs': 'Rust',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.ps1': 'PowerShell',
  '.tf': 'Terraform',
  '.ex': 'Elixir',
  '.scala': 'Scala',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ header',
}));

function baseName(filePath) {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}

function extensionOf(filePath) {
  const name = baseName(filePath);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index);
}

function matches(patterns, filePath) {
  const name = baseName(filePath);
  return patterns.some((pattern) => pattern.test(name) || pattern.test(filePath));
}

export function classifyFiles(files, { dotnet = false } = {}) {
  const ignored = [];
  const kept = [];
  for (const filePath of files) {
    const segments = filePath.split('/');
    const directorySegments = segments.slice(0, -1);
    const ignoredByDirectory = directorySegments.some((segment) => (
      IGNORED_DIRECTORIES.has(segment) || (dotnet && DOTNET_OUTPUT.has(segment))
    ));
    if (ignoredByDirectory || LOCKFILES.has(baseName(filePath))) {
      ignored.push(filePath);
      continue;
    }
    kept.push(filePath);
  }

  const languages = new Map();
  for (const filePath of kept) {
    const language = LANGUAGES.get(extensionOf(filePath));
    if (!language) continue;
    languages.set(language, (languages.get(language) || 0) + 1);
  }

  const infrastructure = kept.filter((filePath) => (
    matches(INFRASTRUCTURE, filePath) || INFRASTRUCTURE_DIRECTORIES.some((prefix) => filePath.startsWith(prefix))
  ));

  return {
    fileCount: kept.length,
    ignoredCount: ignored.length,
    languages: [...languages.entries()]
      .map(([name, files_]) => ({ name, files: files_ }))
      .sort((left, right) => right.files - left.files || left.name.localeCompare(right.name)),
    manifests: kept.filter((filePath) => matches(MANIFESTS, filePath)),
    entrypoints: kept.filter((filePath) => matches(ENTRYPOINTS, filePath)),
    infrastructure,
    ci: kept.filter((filePath) => CI.some((pattern) => pattern.test(filePath))),
    configuration: kept.filter((filePath) => matches(CONFIGURATION, filePath)),
    documentation: kept.filter((filePath) => matches(DOCUMENTATION, filePath)),
  };
}

export function buildInventory(repository, { revision } = {}) {
  const pinned = revision || repository.head();
  if (!pinned) {
    throw new Error('Repository has no resolvable revision; commit at least once before running the inventory.');
  }
  const listing = repository.run(['ls-tree', '-r', '--name-only', pinned]);
  if (listing.status !== 0) {
    throw new Error(`Could not list tracked files at ${pinned}: ${listing.stderr.trim() || 'git failed'}`);
  }
  const files = listing.stdout.split('\n').map((entry) => entry.trim()).filter(Boolean);
  const dotnet = files.some((filePath) => /\.(?:csproj|fsproj|vbproj|sln)$/.test(filePath));
  const classified = classifyFiles(files, { dotnet });
  return {
    schema_version: 1,
    repository: {
      root: repository.root,
      revision: pinned,
      url: repository.originUrl(),
    },
    trackedFiles: files.length,
    dotnetOutputIgnored: dotnet,
    ...classified,
  };
}

function section(title, items, empty = 'Not identified from repository evidence.') {
  if (!items.length) return `### ${title}\n\n${empty}\n`;
  return `### ${title}\n\n${items.map((item) => `- \`${item}\``).join('\n')}\n`;
}

export function renderInventoryMarkdown(inventory) {
  const languages = inventory.languages.length
    ? inventory.languages.map((entry) => `| ${entry.name} | ${entry.files} |`).join('\n')
    : '| Not identified from repository evidence. | 0 |';
  return `# Repository Inventory

Status: observed. Every entry below is a tracked file at the pinned revision.

- Repository: ${inventory.repository.url ? `\`${inventory.repository.url}\`` : 'Not identified from repository evidence.'}
- Revision: \`${inventory.repository.revision}\`
- Tracked files: ${inventory.trackedFiles}
- Analyzed files: ${inventory.fileCount}
- Excluded files: ${inventory.ignoredCount} (generated output, dependency trees, lockfiles${inventory.dotnetOutputIgnored ? ', .NET bin/obj' : ''})

## Languages

| Language | Files |
|---|---|
${languages}

## Surfaces

${section('Build manifests and package managers', inventory.manifests)}
${section('Entrypoints', inventory.entrypoints)}
${section('Infrastructure and deployment', inventory.infrastructure)}
${section('CI/CD', inventory.ci)}
${section('Configuration', inventory.configuration)}
${section('Existing documentation', inventory.documentation)}
## Not analyzed

Directories excluded by the discovery policy: \`node_modules\`, \`vendor\`, \`dist\`, \`build\`, \`coverage\`, \`.idea\`, \`.vscode\`${inventory.dotnetOutputIgnored ? ', `bin`, `obj`' : ''}. Lockfiles are excluded unless a specific dependency version must be proven.
`;
}
