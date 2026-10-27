# syntax=docker/dockerfile:1.27.1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# (Dependabot doesn't track the syntax line; bump it by hand alongside apps/web/Dockerfile's.)

# Build from the repo root: docker build -f apps/custodian/Dockerfile .
# One image for both Compose services: `custodian` (Uvicorn, the default command) and
# `custodian-migrate` (`alembic upgrade head`, then exits).
#
# Every base image is pinned by digest; the tag is only a hint for Dependabot, which bumps both.
# The runtime is Debian slim rather than distroless (apps/web's choice): Google's distroless
# Python image ships Debian's Python, which is older than the 3.15 the custodian pins.

# --- uv: only its binary is used, by the build stage
FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

# --- python: the interpreter both stages share. The virtualenv's `python` is a symlink to this
# image's interpreter, so the build and runtime stages must start from the same one.
FROM python:3.15.2-slim-trixie@sha256:197f6622a70b727a4e61bdac13a73b4e2b914b896aa5a729ceb1f45a09bde5fa AS python

# --- build: the locked runtime dependencies and the custodian, in a virtualenv
FROM python AS build
COPY --from=uv /uv /usr/local/bin/uv
# Use the image's Python, never a downloaded one; copy packages out of the cache mount rather than
# hard-link them (the cache isn't in the image); compile site-packages to bytecode now, because
# the running container can't write it (its filesystem is read-only).
ENV UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON_PREFERENCE=only-system \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
# The same layout as the repo: world.py and ledger_fixture.py find the world file and the ledger
# fixture by climbing from their own path, so the project keeps its place under apps/custodian/.
WORKDIR /app/apps/custodian
# Dependencies first, so this layer is rebuilt only when the lockfile changes. `--locked` fails if
# uv.lock and pyproject.toml disagree, and `--no-dev` leaves out pytest, Ruff, pyright and the rest.
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    --mount=type=bind,source=apps/custodian/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=apps/custodian/uv.lock,target=uv.lock \
    --mount=type=bind,source=apps/custodian/.python-version,target=.python-version \
    uv sync --locked --no-dev --no-install-project
COPY apps/custodian/pyproject.toml apps/custodian/uv.lock apps/custodian/.python-version ./
COPY apps/custodian/src ./src
COPY apps/custodian/migrations ./migrations
COPY apps/custodian/fixtures/ledger-v0.json ./fixtures/
# The Factor file's Pin and the committed Treasury yields. The Factor file itself is never in the
# image or downloaded by the build: the running custodian downloads it into its cache (below).
COPY apps/custodian/market ./market
COPY world/v0.json /app/world/
# Installs the custodian itself, as an editable install: the virtualenv points at ./src, so the
# paths above stay where the code expects them. compileall does for our code what
# UV_COMPILE_BYTECODE did for the dependencies.
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv \
    uv sync --locked --no-dev \
    && python -m compileall -q src migrations

# --- custodian: the interpreter, the virtualenv and the code; no uv, compiler or dev tooling
FROM python AS custodian
ENV PATH=/app/apps/custodian/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FACTOR_FILE_CACHE=/var/cache/custodian/factor-files
WORKDIR /app/apps/custodian
# Owned by root and read-only to the `nobody` (65534) user that runs it.
COPY --from=build /app /app
# The Factor file's cache, the one folder `nobody` writes. Compose mounts a named volume here; a
# new volume copies this folder's owner, so the first start can download into it.
RUN mkdir -p /var/cache/custodian/factor-files \
    && chown -R 65534:65534 /var/cache/custodian
USER 65534:65534
EXPOSE 8000
# The image's own Python, since slim has no curl: any error or non-2xx status exits non-zero.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]
CMD ["uvicorn", "custodian.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header"]
