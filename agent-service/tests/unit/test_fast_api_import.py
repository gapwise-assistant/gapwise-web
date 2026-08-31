import os
import subprocess
import sys
from pathlib import Path


def test_fast_api_app_imports_without_application_default_credentials() -> None:
    agent_service_dir = Path(__file__).resolve().parents[2]
    script = """
import google.auth
from google.auth.exceptions import DefaultCredentialsError

def no_credentials(*args, **kwargs):
    raise DefaultCredentialsError('ADC intentionally unavailable for this test')

google.auth.default = no_credentials
import app.fast_api_app  # noqa: F401
print('fast_api_app imported')
"""
    environment = os.environ.copy()
    environment.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=agent_service_dir,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "fast_api_app imported" in result.stdout
