#!/usr/bin/env python3
"""
Run MashrutGo locally with one command: `./start.sh` (macOS/Linux) or `start.cmd` (Windows).

Creates the backend virtualenv, installs both dependency sets, applies migrations, seeds the
Andijon demo data and runs the API and the web app together, streaming both logs. Ctrl+C stops
everything.

Written for Python 3.8 syntax on purpose: it is the bootstrapper, so it has to run under whatever
`python3` the machine happens to have (macOS still ships 3.9) before it can build a newer venv.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(REPO, "backend")
FRONTEND = os.path.join(REPO, "frontend")
VENV = os.path.join(BACKEND, ".venv")
STAMPS = os.path.join(REPO, ".dev-stamps")

IS_WINDOWS = os.name == "nt"
MIN_PYTHON = (3, 10)
MIN_NODE = 18

DEFAULT_BACKEND_PORT = 8000
DEFAULT_FRONTEND_PORT = 5173


# --------------------------------------------------------------------------------------- output

def _supports_colour() -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    if not sys.stdout.isatty():
        return False
    if IS_WINDOWS:
        # Windows 10+ terminals understand ANSI once virtual terminal processing is on.
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
            return True
        except Exception:
            return False
    return True


COLOUR = _supports_colour()


def paint(text: str, code: str) -> str:
    return "\033[{0}m{1}\033[0m".format(code, text) if COLOUR else text


def info(message: str) -> None:
    print("{0} {1}".format(paint("::", "36;1"), message), flush=True)


def warn(message: str) -> None:
    print("{0} {1}".format(paint("!!", "33;1"), message), flush=True)


def fail(message: str, hint: str = "") -> "NoReturn":  # type: ignore[valid-type]
    print("{0} {1}".format(paint("xx", "31;1"), message), file=sys.stderr, flush=True)
    if hint:
        print("   {0}".format(hint), file=sys.stderr, flush=True)
    sys.exit(1)


# ---------------------------------------------------------------------------------- prerequisites

def _version_of(executable: str):
    """(major, minor) of a Python interpreter, or None if it cannot be run."""
    try:
        out = subprocess.check_output(
            [executable, "-c", "import sys;print('%d.%d' % sys.version_info[:2])"],
            stderr=subprocess.DEVNULL,
            universal_newlines=True,
        ).strip()
        major, minor = out.split(".")
        return (int(major), int(minor))
    except Exception:
        return None


def find_python():
    """
    A Python new enough to build the backend venv.

    The interpreter running this script is often not it: macOS ships 3.9 as `python3`, while the
    backend needs 3.10+. Candidates are tried newest first.
    """
    candidates = []
    for minor in (12, 13, 11, 10):
        candidates.append("python3.{0}".format(minor))
    candidates += ["python3", "python"]

    found = []
    for name in candidates:
        path = shutil.which(name)
        if not path:
            continue
        version = _version_of(path)
        if version and version >= MIN_PYTHON:
            found.append((version, path))

    if IS_WINDOWS and not found:
        # The Windows launcher can reach interpreters that are not on PATH.
        launcher = shutil.which("py")
        if launcher:
            for minor in (12, 13, 11, 10):
                try:
                    out = subprocess.check_output(
                        [launcher, "-3.{0}".format(minor), "-c", "import sys;print(sys.executable)"],
                        stderr=subprocess.DEVNULL,
                        universal_newlines=True,
                    ).strip()
                    if out:
                        found.append(((3, minor), out))
                except Exception:
                    continue

    if not found:
        fail(
            "Python {0}.{1}+ topilmadi (backend shu versiyani talab qiladi).".format(*MIN_PYTHON),
            "https://www.python.org/downloads/ — o‘rnatgach shu buyruqni qayta ishga tushiring."
            if IS_WINDOWS
            else "macOS: brew install python@3.12 · Ubuntu: sudo apt install python3.12 python3.12-venv",
        )
    found.sort(reverse=True)
    return found[0][1]


def check_node() -> None:
    node = shutil.which("node")
    if not node:
        fail(
            "Node.js topilmadi (frontend uchun kerak).",
            "https://nodejs.org — LTS (20 yoki undan yangi) versiyasini o‘rnating.",
        )
    try:
        raw = subprocess.check_output([node, "-v"], universal_newlines=True).strip()
    except Exception:
        fail("Node.js ishga tushmadi: {0}".format(node))
    match = re.match(r"v(\d+)", raw)
    if match and int(match.group(1)) < MIN_NODE:
        fail(
            "Node.js {0} juda eski (kamida {1} kerak).".format(raw, MIN_NODE),
            "https://nodejs.org — LTS versiyasini o‘rnating.",
        )
    if not shutil.which(npm_binary()):
        fail("npm topilmadi. Node.js o‘rnatilgan, lekin npm yo‘q.")


def npm_binary() -> str:
    return "npm.cmd" if IS_WINDOWS else "npm"


def venv_python() -> str:
    return os.path.join(VENV, "Scripts", "python.exe") if IS_WINDOWS else os.path.join(VENV, "bin", "python")


# ------------------------------------------------------------------------------------ setup steps

def _stamp_path(name: str) -> str:
    return os.path.join(STAMPS, name)


def _digest(paths) -> str:
    sha = hashlib.sha256()
    for path in paths:
        try:
            with open(path, "rb") as handle:
                sha.update(handle.read())
        except IOError:
            sha.update(b"<missing>")
    return sha.hexdigest()


def _stamp_is_current(name: str, digest: str) -> bool:
    try:
        with open(_stamp_path(name), "r") as handle:
            return handle.read().strip() == digest
    except IOError:
        return False


def _write_stamp(name: str, digest: str) -> None:
    if not os.path.isdir(STAMPS):
        os.makedirs(STAMPS)
    with open(_stamp_path(name), "w") as handle:
        handle.write(digest)


def run(cmd, cwd: str, what: str) -> None:
    result = subprocess.call(cmd, cwd=cwd)
    if result != 0:
        fail("{0} muvaffaqiyatsiz tugadi (exit {1}).".format(what, result))


def ensure_backend(force: bool) -> None:
    requirements = [
        os.path.join(BACKEND, "requirements.txt"),
        os.path.join(BACKEND, "requirements-dev.txt"),
    ]

    if os.path.isdir(VENV):
        current = _version_of(venv_python())
        if current is None or current < MIN_PYTHON:
            warn("Mavjud venv yaroqsiz yoki eski — qayta yaratilmoqda.")
            shutil.rmtree(VENV, ignore_errors=True)

    if not os.path.isdir(VENV):
        interpreter = find_python()
        version = _version_of(interpreter)
        info("Python venv yaratilmoqda ({0}.{1})".format(version[0], version[1]))
        run([interpreter, "-m", "venv", VENV], BACKEND, "venv yaratish")
        force = True  # a fresh venv always needs its packages

    digest = _digest(requirements)
    if force or not _stamp_is_current("backend-deps", digest):
        info("Backend kutubxonalari o‘rnatilmoqda")
        run([venv_python(), "-m", "pip", "install", "--quiet", "--upgrade", "pip"], BACKEND, "pip yangilash")
        run(
            [venv_python(), "-m", "pip", "install", "--quiet", "-r", "requirements-dev.txt"],
            BACKEND,
            "backend kutubxonalari",
        )
        _write_stamp("backend-deps", digest)

    env_file = os.path.join(BACKEND, ".env")
    if not os.path.exists(env_file):
        example = os.path.join(BACKEND, ".env.example")
        if os.path.exists(example):
            shutil.copyfile(example, env_file)
            info("backend/.env yaratildi (.env.example nusxasi)")


def ensure_frontend(force: bool) -> None:
    lock = os.path.join(FRONTEND, "package-lock.json")
    digest = _digest([lock])
    modules = os.path.join(FRONTEND, "node_modules")

    if force or not os.path.isdir(modules) or not _stamp_is_current("frontend-deps", digest):
        info("Frontend kutubxonalari o‘rnatilmoqda")
        command = "ci" if os.path.exists(lock) else "install"
        run([npm_binary(), command, "--no-audit", "--no-fund"], FRONTEND, "npm {0}".format(command))
        _write_stamp("frontend-deps", digest)


# ------------------------------------------------------------------------------- process plumbing

def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def require_free_port(port: int, what: str) -> None:
    if port_is_free(port):
        return
    hint = (
        'netstat -ano | findstr :{0}   (keyin: taskkill /PID <pid> /F)'.format(port)
        if IS_WINDOWS
        else "lsof -ti tcp:{0} | xargs kill".format(port)
    )
    fail("{0} porti {1} band.".format(what, port), "Band qilgan jarayonni to‘xtating: " + hint)


class Service(object):
    """A child process whose output is streamed with a coloured prefix."""

    def __init__(self, name: str, colour: str, cmd, cwd: str, env):
        self.name = name
        self.colour = colour
        self.cmd = cmd
        self.cwd = cwd
        self.env = env
        self.process = None
        self.thread = None

    def start(self) -> None:
        kwargs = dict(
            cwd=self.cwd,
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )
        if IS_WINDOWS:
            # Own process group, so Ctrl+C in this console does not race our own shutdown.
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        try:
            self.process = subprocess.Popen(self.cmd, **kwargs)
        except OSError as exc:
            fail("{0} ishga tushmadi: {1}".format(self.name, exc))
        self.thread = threading.Thread(target=self._pump, daemon=True)
        self.thread.start()

    def _pump(self) -> None:
        prefix = paint("[{0}]".format(self.name), self.colour)
        assert self.process is not None and self.process.stdout is not None
        for line in self.process.stdout:
            sys.stdout.write("{0} {1}".format(prefix, line))
            sys.stdout.flush()

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop(self) -> None:
        if self.process is None or self.process.poll() is not None:
            return
        try:
            if IS_WINDOWS:
                # Vite and uvicorn spawn children (esbuild, reloader); /T takes the whole tree.
                subprocess.call(
                    ["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
        except Exception:
            try:
                self.process.terminate()
            except Exception:
                pass
        try:
            self.process.wait(timeout=10)
        except Exception:
            try:
                if not IS_WINDOWS:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
            except Exception:
                pass


def wait_for_http(url: str, timeout: float, still_alive) -> bool:
    """
    Wait until something is serving HTTP at `url`.

    Any HTTP status counts as ready, including 4xx: the question is whether the server is
    listening, not what it thinks of this particular request. The Accept header matters --
    Vite's SPA fallback only serves index.html to clients that ask for text/html, and answers
    404 otherwise, which is exactly what a bare urllib probe looks like.
    """
    request = urllib.request.Request(
        url,
        headers={"Accept": "text/html,application/json,*/*", "User-Agent": "mashrutgo-dev-launcher"},
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not still_alive():
            return False
        try:
            urllib.request.urlopen(request, timeout=3).close()
            return True
        except urllib.error.HTTPError:
            return True  # it answered, so it is up
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.4)
    return False


# ------------------------------------------------------------------------------------------- main

def backend_env(args) -> dict:
    env = os.environ.copy()
    env.setdefault("APP_ENV", "development")
    env.setdefault("AUTO_MIGRATE", "true")
    env["SEED_DEMO_DATA"] = "false" if args.no_seed else "true"
    env.setdefault("PAYMENTS_SANDBOX", "true")
    env.setdefault("PYTHONUNBUFFERED", "1")
    if args.offline_routing:
        env["ROUTING_PROVIDER"] = "geodesic"
    return env


def frontend_env(args) -> dict:
    env = os.environ.copy()
    env.setdefault("FORCE_COLOR", "1")
    # Vite proxies /api to the backend; tell it where the backend actually is.
    env["VITE_DEV_API_TARGET"] = "http://127.0.0.1:{0}".format(args.backend_port)
    return env


def banner(args, seeded: bool) -> None:
    line = paint("─" * 62, "90")
    print("")
    print(line)
    print("  {0}".format(paint("MashrutGo ishga tushdi", "32;1")))
    print("")
    print("  Web ilova   {0}".format(paint("http://localhost:{0}".format(args.frontend_port), "36")))
    print("  API (docs)  {0}".format(paint("http://localhost:{0}/api/v1/docs".format(args.backend_port), "36")))
    if seeded:
        print("")
        print("  Demo hisoblar (parol):")
        print("    Super Admin     +998901234567   admin123")
        print("    Uyushma admin   +998901234568   uyushma123")
        print("    Haydovchi       +998901110001   driver123")
        print("    Mijoz           +998901112233   client123")
    print("")
    print("  To‘xtatish: {0}".format(paint("Ctrl+C", "33")))
    print(line)
    print("")
    # stdout is block-buffered when it is not a terminal (a log file, an IDE pane); without this
    # the banner would sit unseen until some other line happens to flush it.
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="start",
        description="MashrutGo'ni bitta buyruq bilan ishga tushiradi (backend + frontend).",
    )
    parser.add_argument("--backend-only", action="store_true", help="faqat API")
    parser.add_argument("--frontend-only", action="store_true", help="faqat web ilova")
    parser.add_argument("--no-install", action="store_true", help="kutubxonalarni o‘rnatishni o‘tkazib yuborish")
    parser.add_argument("--reinstall", action="store_true", help="kutubxonalarni majburan qayta o‘rnatish")
    parser.add_argument("--no-seed", action="store_true", help="demo ma’lumotlarsiz ishga tushirish")
    parser.add_argument("--offline-routing", action="store_true", help="OSRM o‘rniga geodesic (internetsiz)")
    parser.add_argument("--backend-port", type=int, default=DEFAULT_BACKEND_PORT)
    parser.add_argument("--frontend-port", type=int, default=DEFAULT_FRONTEND_PORT)
    args = parser.parse_args()

    if args.backend_only and args.frontend_only:
        fail("--backend-only va --frontend-only birga ishlatilmaydi.")

    want_backend = not args.frontend_only
    want_frontend = not args.backend_only

    info("MashrutGo — {0} {1}".format(platform.system(), platform.release()))

    if want_backend:
        require_free_port(args.backend_port, "Backend")
    if want_frontend:
        require_free_port(args.frontend_port, "Frontend")

    if want_frontend:
        check_node()

    if not args.no_install:
        if want_backend:
            ensure_backend(args.reinstall)
        if want_frontend:
            ensure_frontend(args.reinstall)
    elif want_backend and not os.path.exists(venv_python()):
        fail("venv yo‘q, lekin --no-install berilgan.", "Avval --no-install'siz ishga tushiring.")

    services = []
    if want_backend:
        services.append(
            Service(
                "api",
                "35;1",
                [
                    venv_python(),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--reload",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(args.backend_port),
                ],
                BACKEND,
                backend_env(args),
            )
        )
    if want_frontend:
        services.append(
            Service(
                "web",
                "34;1",
                [npm_binary(), "run", "dev", "--", "--host", "127.0.0.1", "--port", str(args.frontend_port)],
                FRONTEND,
                frontend_env(args),
            )
        )

    stopping = threading.Event()

    def shutdown(*_):
        if stopping.is_set():
            return
        stopping.set()
        print("")
        info("To‘xtatilmoqda…")
        for service in reversed(services):
            service.stop()

    signal.signal(signal.SIGINT, shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, shutdown)

    for service in services:
        info("{0} ishga tushmoqda".format(service.name))
        service.start()

    try:
        if want_backend:
            alive = services[0].is_running
            url = "http://127.0.0.1:{0}/api/v1/health".format(args.backend_port)
            info("Migratsiyalar va demo ma’lumotlar kutilmoqda…")
            if not wait_for_http(url, 180, alive):
                shutdown()
                fail("Backend ishga tushmadi — yuqoridagi [api] jurnaliga qarang.")

        if want_frontend:
            web = services[-1]
            if not wait_for_http("http://127.0.0.1:{0}".format(args.frontend_port), 120, web.is_running):
                shutdown()
                fail("Frontend ishga tushmadi — yuqoridagi [web] jurnaliga qarang.")

        banner(args, seeded=want_backend and not args.no_seed)

        while not stopping.is_set():
            for service in services:
                if not service.is_running():
                    code = service.process.returncode if service.process else "?"
                    warn("{0} to‘xtadi (exit {1}) — qolganlari ham to‘xtatilmoqda.".format(service.name, code))
                    shutdown()
                    return 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        shutdown()
    finally:
        shutdown()

    return 0


if __name__ == "__main__":
    sys.exit(main())
