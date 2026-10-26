# Never built. This file only pins the image Testcontainers starts beside every test container:
# its reaper (Ryuk), which removes a run's containers when the test process exits. Both harnesses
# read the `FROM` line below instead of copying it, so this is the one place it lives:
# - TypeScript: `reaperImage()` in packages/testing/src/reaper.ts (integration tests, e2e)
# - Python: `reaper_image()` in apps/custodian/tests/integration/reaper.py
#
# Dependabot's `docker` entry for this directory bumps the tag and digest weekly, like every other
# image. Before merging a bump, run what starts a reaper: `pnpm test:integration` and `pnpm e2e`.
FROM testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0
