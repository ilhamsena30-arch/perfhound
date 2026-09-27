"""Subprocess command runner used by backends.

The runner is injected so backends can be unit-tested without a real device.
"""

from __future__ import annotations

import subprocess
from typing import Optional, Sequence


class CommandError(RuntimeError):
    """Raised when a command exits non-zero."""

    def __init__(self, command: Sequence[str], returncode: int, stderr: str) -> None:
        self.command = list(command)
        self.returncode = returncode
        self.stderr = stderr
        super().__init__(
            f"command failed ({returncode}): {' '.join(self.command)}\n{stderr.strip()}"
        )


class SubprocessRunner:
    """Runs commands synchronously and returns stdout, raising on failure."""

    def run(
        self,
        command: Sequence[str],
        *,
        timeout: Optional[float] = None,
    ) -> str:
        proc = subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if proc.returncode != 0:
            raise CommandError(command, proc.returncode, proc.stderr)
        return proc.stdout
