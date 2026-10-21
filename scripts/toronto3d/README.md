# Pinned PotreeConverter source patches

Base: https://github.com/potree/PotreeConverter.git at
`c2cb61843bf2b901e8e257874b1a6dcf67792fb2`. Upstream license and disclaimer
are retained in `POTREE-LICENSE` (BSD-2-Clause). The upstream checkout also
contains third-party licenses: retain its generated `licenses/` directory when
redistributing a build. Dataset licensing is separate (CC BY-NC 4.0).

Apply **both patches in numbered order**, not the older ignored patch exports:

1. `01-darwin.patch`: exact diff upstream → local Darwin compatibility commit
   `95b426b9c1ccdc33774c543b6d5238c698cc343f`. POSIX buffers/seek, Mach process
   monitoring, explicit JSON conversions and imported TBB linkage. Darwin memory
   monitoring reports physical RAM as virtual-total (not swap); CPU usage is
   normalized process CPU, not system-wide load.
2. `02-hierarchy.patch`: exact cumulative diff from that Darwin base → local
   `975f3b468845b1673d83dc2c8ff896125fab5034` (includes earlier `8943d04`).
   Initialize types before linking postorder nodes; serialize childless roots as
   leaves; synchronize cross-batch proxy masks; skip unreachable singleton records.
   These are required for the strict validator, not an optional platform patch.

Provenance: exported from the original ignored checkout at
`data/processed/toronto3d/tooling/PotreeConverter`, using `git diff BASE TARGET`.
The older ignored `potree-darwin.patch` misleadingly also included the initial
hierarchy fix, while `hierarchy-v2.patch` only contained its final increment.
The tracked pair intentionally splits cleanly into Darwin and **all** hierarchy
changes, with no author email, host path, logs, binary, or dataset embedded.
The two patches recreate the final local source tree; do not apply the old
ignored patches as well. Local commit IDs identify provenance, not public refs
that the upstream remote is expected to provide.

## Build from repository root

This is the previously exercised **Darwin arm64 + Homebrew GCC** route, not a
cross-platform installer. Install Git, CMake, a C++23-capable GCC and TBB using
your platform's package manager first. Historical build versions: Darwin 24.6,
CMake 4.4.3, GCC 16.2.0, TBB runtime 12.19. These dependencies are not locked or
vendored here. AppleClang failed on upstream parallel-execution policy support;
use GCC for this route. Other platforms/compiler versions need their own build
and full validation; none are certified by these instructions.

```sh
# From repository root; all local tooling remains ignored.
ROOT="$PWD"
TOOLING="$ROOT/data/processed/toronto3d/tooling"
SRC="$TOOLING/PotreeConverter"
mkdir -p "$TOOLING"
# Use a new location if the original local checkout already exists.
git clone https://github.com/potree/PotreeConverter.git "$SRC"
git -C "$SRC" checkout --detach c2cb61843bf2b901e8e257874b1a6dcf67792fb2
git -C "$SRC" apply --check "$ROOT/scripts/toronto3d/01-darwin.patch"
git -C "$SRC" apply "$ROOT/scripts/toronto3d/01-darwin.patch"
git -C "$SRC" apply --check "$ROOT/scripts/toronto3d/02-hierarchy.patch"
git -C "$SRC" apply "$ROOT/scripts/toronto3d/02-hierarchy.patch"

# Select installed compilers explicitly; adjust executable names as necessary.
CC_BIN="$(command -v gcc-16)"
CXX_BIN="$(command -v g++-16)"
# On Homebrew, make the installed TBB package discoverable to CMake.
cmake -S "$SRC" -B "$SRC/build-gcc" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_C_COMPILER="$CC_BIN" -DCMAKE_CXX_COMPILER="$CXX_BIN" \
  -DCMAKE_PREFIX_PATH="$(brew --prefix tbb)"
cmake --build "$SRC/build-gcc" --parallel 6
shasum -a 256 "$SRC/build-gcc/PotreeConverter"
```

LASzip and Brotli sources are bundled in that upstream commit. No additional
external source patches or ignored files are needed for the documented patch
sequence. The resulting executable may need its build-tree LASzip library,
Homebrew TBB and GCC runtime; copying just the binary is not portable.
Do not expect its hash to equal the recorded reference hash on another host.
Concurrent conversion can change ordering/bytes; exact source-row provenance
and semantic validation, not byte-identical octrees, are the reproducibility
criterion. Upstream warnings remain; this export does not constitute a new
converter build or third-party code review.

Continue with [environment, conversion and strict validation](../../docs/toronto3d-preprocessing.md).
