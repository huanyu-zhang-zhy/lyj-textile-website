"""Run the monitor alongside an existing service, with resource and health guards.

Does not change the existing application's files, environment or start command.
Render restarts can interrupt this detached process; persisted monitor state can resume.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request


def memory_usage(root=Path('/sys/fs/cgroup')):
    limit = int((root / 'memory.max').read_text().strip())
    entries = dict(line.split() for line in (root / 'memory.stat').read_text().splitlines())
    # Anonymous and kernel memory are not readily reclaimable like clean file cache.
    used = int(entries['anon']) + int(entries.get('kernel', 0))
    current = int((root / 'memory.current').read_text().strip())
    return {'resident_bytes': used, 'current_bytes': current, 'limit_bytes': limit}


def stop_child(child):
    if child.poll() is not None:
        return
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=4)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=4)


def guarded(command, env, log, status_file, seconds, check_health=True):
    before = memory_usage()
    ceiling = int(before['limit_bytes'] * 0.78)
    if before['resident_bytes'] >= ceiling - 48 * 1048576:
        raise RuntimeError('Insufficient memory headroom; refusing to start')
    port = os.environ.get('PORT', '10000')
    health_url = 'http://127.0.0.1:' + str(int(port)) + '/health'
    if check_health:
        with urllib.request.urlopen(health_url, timeout=3) as response:
            if response.status != 200:
                raise RuntimeError('Existing API health check failed before start')
    result = {'command': command[:2], 'started_at': time.time(), 'peak_resident_bytes': before['resident_bytes'], 'memory_ceiling_bytes': ceiling}
    stopped = None
    health_failures = 0
    next_health = 0
    with log.open('a') as output:
        child = subprocess.Popen(command, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            os.setpriority(os.PRIO_PROCESS, child.pid, 15)
        except Exception:
            stop_child(child)
            raise
        def interrupted(signum, frame):
            nonlocal stopped
            stopped = 'supervisor_interrupted'
        old_handlers = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            until = time.monotonic() + seconds
            while child.poll() is None:
                m = memory_usage()
                result['peak_resident_bytes'] = max(result['peak_resident_bytes'], m['resident_bytes'])
                if m['resident_bytes'] >= ceiling:
                    stopped = 'memory_guard'
                if time.monotonic() >= until:
                    stopped = 'supervisor_time_limit'
                if check_health and time.monotonic() >= next_health:
                    next_health = time.monotonic() + 10
                    try:
                        with urllib.request.urlopen(health_url, timeout=2) as response:
                            healthy = response.status == 200
                        health_failures = 0 if healthy else health_failures + 1
                    except Exception:
                        health_failures += 1
                    if health_failures >= 2:
                        stopped = 'existing_api_health_guard'
                if stopped:
                    stop_child(child)
                    break
                time.sleep(0.2)
        finally:
            # Fail closed if a guard itself fails, too.
            stop_child(child)
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)
            result.update({'finished_at': time.time(), 'reason': stopped or 'process_exited', 'return_code': child.returncode})
            temp = status_file.with_suffix('.tmp')
            temp.write_text(json.dumps(result, indent=2))
            temp.replace(status_file)
    if stopped or child.returncode:
        raise RuntimeError('Task stopped: ' + str(result))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['setup', 'smoke', 'run'])
    parser.add_argument('--base', default='/var/data/visa-monitor')
    args = parser.parse_args()
    base = Path(args.base).resolve()
    base.mkdir(parents=True, exist_ok=True)
    with (base / 'supervisor.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        env = {k: v for k, v in os.environ.items() if k in ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'LD_LIBRARY_PATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR']}
        env.update({'PLAYWRIGHT_BROWSERS_PATH': str(base / 'browsers'), 'NODE_OPTIONS': '--max-old-space-size=64', 'LOW_MEMORY_BROWSER': 'true'})
        if args.mode == 'setup':
            guarded(['npm', 'ci', '--prefix', str(base), '--cache', str(base / 'npm-cache'), '--ignore-scripts', '--no-audit', '--no-fund'], env, base / 'setup.log', base / 'setup-guard.json', 240)
            result = guarded(['node', str(base / 'node_modules/playwright/cli.js'), 'install', 'chromium', '--only-shell'], env, base / 'setup.log', base / 'setup-guard.json', 300)
        else:
            state_dir = base / ('smoke' if args.mode == 'smoke' else 'run')
            env.update({'MONITOR_ENABLED': 'true', 'TARGET_MONTH': '2026-11', 'INTERVAL_SECONDS': '60', 'DURATION_HOURS': '24', 'DATA_DIR': str(state_dir)})
            command = ['node', str(base / 'monitor.cjs')]
            if args.mode == 'smoke':
                command.append('--once')
            try:
                result = guarded(command, env, base / (args.mode + '.log'), base / (args.mode + '-guard.json'), 60 if args.mode == 'smoke' else 86520)
            except RuntimeError:
                guard_file = base / (args.mode + '-guard.json')
                reason = json.loads(guard_file.read_text()).get('reason') if guard_file.exists() else None
                if reason and reason != 'process_exited' and (state_dir / 'state.json').exists():
                    report_env = dict(env, MONITOR_STOP_REASON=reason)
                    # No browser launch: update only this monitor's state and reports.
                    subprocess.run(['node', '-e', 'const m=require(process.argv[1]);const c=m.config();const s=m.loadState(c);s.status="stopped_"+process.env.MONITOR_STOP_REASON;s.stopReason=process.env.MONITOR_STOP_REASON;m.persist(c,s);', str(base / 'monitor.cjs')], env=report_env, check=True, timeout=10)
                raise
        print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    main()
