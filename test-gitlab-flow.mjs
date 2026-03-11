// Test script — replicates the exact flow Otto uses for related files.
// Usage: GITLAB_PAT=glpat-xxx node test-gitlab-flow.mjs

const PAT = process.env.GITLAB_PAT;
if (!PAT) { console.error('Set GITLAB_PAT env var'); process.exit(1); }

const HOST = 'https://gitlab.com';
const PROJECT_PATH = 'gitlab-org/gitlab';
const MR_IID = 226786;

async function apiFetch(path, raw = false) {
  const url = `${HOST}/api/v4${path}`;
  console.log(`  → GET ${url.slice(0, 120)}...`);
  const res = await fetch(url, {
    headers: { 'PRIVATE-TOKEN': PAT, ...(!raw ? { 'Accept': 'application/json' } : {}) },
  });
  console.log(`  ← ${res.status} ${res.statusText}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.log(`  ← Body: ${body.slice(0, 300)}`);
    return null;
  }
  return raw ? res.text() : res.json();
}

async function run() {
  // Step 1: Resolve project ID from path
  console.log('\n=== Step 1: Fetch project ===');
  const encodedPath = encodeURIComponent(PROJECT_PATH);
  const project = await apiFetch(`/projects/${encodedPath}`);
  if (!project) { console.error('FAILED: Could not fetch project'); return; }
  const projectId = project.id;
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Default branch: ${project.default_branch}`);

  // Step 2: Fetch MR metadata
  console.log('\n=== Step 2: Fetch MR metadata ===');
  const mr = await apiFetch(`/projects/${projectId}/merge_requests/${MR_IID}`);
  if (!mr) { console.error('FAILED: Could not fetch MR'); return; }
  console.log(`  Title: ${mr.title}`);
  console.log(`  Source branch: ${mr.source_branch}`);
  console.log(`  Target branch: ${mr.target_branch}`);
  console.log(`  State: ${mr.state}`);

  // Step 3: Fetch MR changes (diff files)
  console.log('\n=== Step 3: Fetch MR changes ===');
  const changes = await apiFetch(`/projects/${projectId}/merge_requests/${MR_IID}/changes?access_raw_diffs=true`);
  if (!changes) { console.error('FAILED: Could not fetch MR changes'); return; }
  const diffFiles = changes.changes || [];
  console.log(`  Changed files: ${diffFiles.length}`);
  diffFiles.slice(0, 5).forEach(f => console.log(`    - ${f.new_path} (${f.new_file ? 'NEW' : f.deleted_file ? 'DEL' : 'MOD'})`));
  if (diffFiles.length > 5) console.log(`    ... and ${diffFiles.length - 5} more`);

  // Step 4: Fetch file tree (recursive) — this is what gets passed to the AI
  console.log('\n=== Step 4: Fetch file tree ===');
  const tree = await apiFetch(`/projects/${projectId}/repository/tree?ref=${encodeURIComponent(mr.source_branch)}&recursive=true&per_page=100`);
  if (!tree) { console.error('FAILED: Could not fetch file tree'); return; }
  console.log(`  Tree items (first page): ${tree.length}`);
  const blobs = tree.filter(t => t.type === 'blob');
  console.log(`  Blobs (files): ${blobs.length}`);
  blobs.slice(0, 5).forEach(b => console.log(`    - ${b.path}`));

  // Step 5: Try fetching content for the first changed file
  if (diffFiles.length > 0) {
    const testFile = diffFiles[0].new_path;
    console.log(`\n=== Step 5: Fetch file content ===`);
    console.log(`  File: ${testFile}`);
    console.log(`  Ref: ${mr.source_branch}`);
    const encodedFile = encodeURIComponent(testFile);
    const content = await apiFetch(
      `/projects/${projectId}/repository/files/${encodedFile}/raw?ref=${encodeURIComponent(mr.source_branch)}`,
      true,
    );
    if (content) {
      console.log(`  Content length: ${content.length} chars`);
      console.log(`  First 200 chars: ${content.slice(0, 200)}`);
    } else {
      console.error(`  FAILED: Could not fetch file content`);
    }
  }

  // Step 6: Try fetching a file that DOESN'T exist (simulate hallucinated path)
  console.log('\n=== Step 6: Fetch non-existent file (should 404) ===');
  const fakeFile = encodeURIComponent('src/this/does/not/exist.ts');
  const fake = await apiFetch(
    `/projects/${projectId}/repository/files/${fakeFile}/raw?ref=${encodeURIComponent(mr.source_branch)}`,
    true,
  );
  console.log(`  Result: ${fake ? 'GOT CONTENT (unexpected!)' : 'null (expected 404)'}`);

  console.log('\n=== Done ===');
}

run().catch(console.error);
