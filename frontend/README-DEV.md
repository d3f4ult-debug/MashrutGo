Frontend developer notes — install & test troubleshooting

This file collects quick commands and steps to get the frontend running locally and to resolve common npm install issues encountered on Windows or when registries return missing/ETARGET errors.

1) Verify Node/npm

- Recommended Node: 18.x or 20.x
- Check versions:

```powershell
node --version
npm --version
```

2) Ensure npm registry is correct

```powershell
# show current registry
npm config get registry
# set to official registry if needed
npm config set registry https://registry.npmjs.org/
# verify cache
npm cache verify
```

3) Clean and install (PowerShell)

```powershell
# from the workspace root
cd frontend
# remove artifacts
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
# install using npm ci (preferred for CI) or npm install locally
npm ci --legacy-peer-deps
# or if npm ci fails, try
npm install --legacy-peer-deps
```

Notes:
- Use `--legacy-peer-deps` when npm reports ERESOLVE peer dependency conflicts.
- If `ETARGET` appears for one specific package/version, it usually means that exact version wasn't found in the registry: either your registry is not npmjs, or the package version was unpublished. Try pinning to a known-good version in `package.json` (we've pinned several conservative versions already).

4) Alternative: use pnpm (often more resilient)

```powershell
# enable corepack and activate pnpm
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
```

5) PowerShell script execution policy (Windows)

If PowerShell blocks npm scripts (e.g. `npm.ps1` errors), run as administrator or adjust policy for current user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

6) Running dev server and tests

```powershell
# start dev server
cd frontend
npm run dev

# run tests (vitest)
npm run test -- --run
# if `vitest` command missing, ensure dependencies installed or use npx:
npx vitest --run
```

7) When installs still fail

- Inspect the first failing error — if it references an `ETARGET` package/version, try searching that package/version on https://www.npmjs.com/.
- Temporarily remove or pin problematic devDependencies in `package.json` (for CI, prefer `npm ci` after creating a fresh `package-lock.json`).
- As a last resort, use a clean Docker image or GitHub Actions runner to reproduce the install; this often isolates local registry/cache problems.

8) CI notes

- A GitHub Actions workflow `.github/workflows/frontend-ci.yml` was added to run `npm ci` and `npm test` on pushes/PRs touching `frontend/`. Use the CI log to reproduce registry or ETARGET failures.

9) Contact me with the first failing `npm ci` output if you still see errors — paste the first 30-50 lines and I'll suggest the precise package pin or workaround.
