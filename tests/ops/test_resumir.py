"""Verifica a cobertura e os limites de cgroups por fase da demo, sem Docker."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "deploy/demo/resumir.py"


def sample(phase, readings, limit=100):
    return {
        "phase": phase, "phase_end": phase, "host_oom_kill": 0, "host_available_mib": 500, "host_used_mib": 400,
        "containers": [
            {"service": service, "mib": amount, "limit_mib": limit, "oom": 0, "oom_kill": 0}
            for service, amount in readings.items()
        ],
    }


def summarize(mode, incomplete=None, usage_partial_mib=8):
    values = {"api": 15, "nginx": 2, "redis": 4}
    stable_phases = ["repouso", "uso", "cabecalhos"]
    if mode == "local":
        values["cassandra"] = 30
        stable_phases.append("compactacao")
    rows = [
        sample("partida", {}), sample("partida", {"redis": 8}), sample("partida", {"api": 15, "redis": 4}),
        sample("partida", values), sample("reinicio", values), sample("reinicio", {"api": 15, "redis": 4}),
        sample("reinicio", {}), sample("reinicio", {"redis": 8}),
    ]
    for phase in stable_phases:
        if phase == incomplete:
            # Todos os nomes aparecem, mas nunca na mesma amostra da fase.
            for missing in values:
                rows.append(sample(phase, {k: v for k, v in values.items() if k != missing}))
        else:
            rows += [sample(phase, values), sample(phase, {**values, "api": 2, "nginx": 10}),
                     sample(phase, {"nginx": usage_partial_mib if phase == "uso" else 8})]
    return run_report(mode, rows, 500)


def run_report(mode, rows, budget, **placement):
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        (directory / "colocacao.json").write_text(json.dumps({"cassandra_mode": mode, **placement}))
        (directory / "memoria.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
        run = subprocess.run([sys.executable, str(SCRIPT), tmp, str(budget), "192"], capture_output=True, text=True)
        return run.returncode, json.loads(run.stdout)


def invalid_limits():
    for value in ("0", "-1", "NaN", "inf", "-Infinity", "1e1000", "inválido"):
        yield value, "192", "STACK_BUDGET_MIB"
        yield "200", value, "MIN_MARGIN_MIB"


class CoverageTest(unittest.TestCase):
    def test_compose_budget_before_startup(self):
        config = json.dumps({"services": {"api": {"mem_limit": 160 * 1048576}}})

        def check(budget, margin):
            return subprocess.run([sys.executable, "-O", str(SCRIPT.with_name("orcamento.py")), budget, margin, "api"],
                                  input=config, text=True, capture_output=True)

        for budget, margin, variable in invalid_limits():
            with self.subTest(budget=budget, margin=margin):
                rejected = check(budget, margin)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn(variable, rejected.stderr)

        self.assertEqual(check("200", "192").returncode, 0)
        self.assertEqual(check("160", "192").returncode, 0)
        over = check("159.5", "192")
        self.assertNotEqual(over.returncode, 0)
        self.assertIn("160 MiB supera orçamento 159.5 MiB", over.stderr)

    def test_budget_and_margin_must_be_positive_and_finite(self):
        phases = ("partida", "repouso", "uso", "cabecalhos", "reinicio")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "colocacao.json").write_text(json.dumps({
                "cassandra_mode": "externo", "redis_mode": "externo", "nginx_mode": "existente",
                "local_services": ["api"]}))

            def calculate(budget, margin):
                return subprocess.run([sys.executable, str(SCRIPT), tmp, budget, margin], capture_output=True, text=True)

            for available, status in ((32, 1), (500, 0)):
                rows = [{**sample(phase, {"api": 20}, 160), "host_available_mib": available} for phase in phases]
                (root / "memoria.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
                run = calculate("200", "192")
                self.assertEqual(run.returncode, status, run.stderr)
                failures = json.loads(run.stdout)["failures"]
                self.assertEqual(any("margem do host" in failure for failure in failures), available == 32)

            self.assertEqual(calculate("160.5", "191.5").returncode, 0)
            saved = (root / "resultado.json").read_bytes()
            for budget, margin, name in invalid_limits():
                with self.subTest(budget=budget, margin=margin):
                    run = calculate(budget, margin)
                    self.assertNotEqual(run.returncode, 0)
                    self.assertIn(name, run.stderr)
                    self.assertEqual((root / "resultado.json").read_bytes(), saved)

    @unittest.skipUnless(sys.platform.startswith("linux") and Path("/sys/fs/cgroup/cgroup.controllers").is_file(),
                         "o pré-voo requer Linux com cgroup v2")
    def test_demo_rejects_invalid_limits_before_starting_services(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            log = directory / "docker.log"
            docker = directory / "docker"
            docker.write_text("""#!/bin/sh
case " $* " in
  *" config --format json "*) echo '{"services":{"api":{"mem_limit":167772160}}}';;
  *" up "*|*" run "*) echo inicio >> "$LOG_OPERACOES"; exit 37;;
esac
""")
            docker.chmod(0o755)
            env = {**os.environ, "PATH": tmp + os.pathsep + os.environ["PATH"], "DOCKER_HOST": "unix:///fixture",
                   "LOG_OPERACOES": str(log), "REPORT_PARENT": tmp, "PYTHONOPTIMIZE": "1", "DEMO_CASSANDRA": "externo",
                   "CASSANDRA_CONTACT_POINTS": "db.test", "CASSANDRA_KEYSPACE": "prova", "DEMO_REDIS_MODE": "externo",
                   "REDIS_URL": "redis://redis.test", "DEMO_NGINX_MODE": "existente", "DEMO_API_PORT": "13000",
                   "PUBLIC_ORIGIN": "http://demo.test", "CASSANDRA_AUTH_ENV_FILE": ""}

            def preflight(budget, margin):
                log.write_text("")
                return subprocess.run(["bash", str(SCRIPT.parents[2] / "tests/ops/demo.sh")],
                                      env={**env, "STACK_BUDGET_MIB": budget, "MIN_MARGIN_MIB": margin},
                                      capture_output=True, text=True)

            for budget, margin, name in invalid_limits():
                with self.subTest(budget=budget, margin=margin):
                    run = preflight(budget, margin)
                    self.assertNotEqual(run.returncode, 0)
                    self.assertIn(name, run.stderr)
                    self.assertEqual(log.read_text(), "")
            for budget, margin in (("200", "192"), ("160.5", "191.5")):
                self.assertEqual(preflight(budget, margin).returncode, 37)
                self.assertEqual(log.read_text(), "inicio\n")

    def test_local_service_coverage_at_startup_and_restart(self):
        values = {"nginx": 2, "api": 15, "redis": 4, "cassandra": 930}
        phases = ["partida", "repouso", "uso", "cabecalhos", "reinicio", "compactacao"]
        for target in ["partida", "reinicio"]:
            other = [sample(p, values, 1024) for p in phases if p != target]
            for readings, expected, floor in [([{"nginx": 2}], None, 2),
                                              ([{"nginx": 2}, values, {"redis": 4}], 951, 951),
                                              ([{name: amount} for name, amount in values.items()], None, 930),
                                              ([values, {"cassandra": 960}], None, 960)]:
                with self.subTest(phase=target, peak=expected, floor=floor):
                    rows = other + [sample(target, amounts, 1024) for amounts in readings]
                    # Um ciclo que cruza a fronteira não cobre os serviços ausentes da fase.
                    rows.append({**sample(target, values, 1024), "phase_end": "repouso"})
                    status, report = run_report("local", rows, 4096, local_services=list(values))
                    phase = report["phases"][target]
                    self.assertEqual(phase["stack_peak_mib"], expected)
                    self.assertEqual(phase["stack_peak_lower_bound_mib"], floor)
                    if expected is None:
                        self.assertNotEqual(status, 0)
                        diagnostics = " ".join(reason for reason in report["failures"] if target in reason)
                        self.assertTrue(diagnostics)
                        if floor == 2:
                            for missing in ["api", "redis", "cassandra"]:
                                self.assertIn(missing, diagnostics)
                        if floor == 930:
                            self.assertIn("simultaneamente", diagnostics)
                            self.assertEqual(phase["complete_samples"], 0)
                    else:
                        self.assertEqual(status, 0, report["failures"])
                        self.assertEqual(phase["complete_samples"], 1)

    def test_phase_change_during_probe_and_transition_safeguards(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            marker = root / "fase"
            marker.write_text("repouso")
            proc = root / "proc/123"
            group = root / "sys/fs/cgroup/api"
            proc.mkdir(parents=True)
            group.mkdir(parents=True)
            (proc / "cgroup").write_text("0::/api\n")
            (root / "proc/meminfo").write_text("MemTotal: 1024000 kB\nMemAvailable: 512000 kB\nSwapFree: 0 kB\n")
            (root / "proc/vmstat").write_text("oom_kill 0\n")
            (group / "memory.events").write_text("oom 0\noom_kill 0\n")
            (group / "memory.max").write_text(str(150 * 1048576))
            (group / "memory.current").write_text(str(30 * 1048576))

            response = nullcontext(SimpleNamespace(status=200))
            def change_during_probe(*_args, **_kwargs):
                replacement = root / "fase.tmp"
                replacement.write_text("uso")
                replacement.replace(marker)
                (group / "memory.current").write_text(str(120 * 1048576))
                return response

            collect = runpy.run_path(str(SCRIPT.with_name("medir.py")))["sample"]
            with (patch.dict(collect.__globals__, PROC=root / "proc", CGROUPS=group.parent,
                             containers=lambda project: [("123", "api")]),
                  patch.dict(os.environ, NEIGHBOR_HEALTH_URL="http://vizinho.test"),
                  patch("urllib.request.urlopen", return_value=response) as probe):
                # A mudança ocorre dentro de urlopen, antes da primeira leitura de cgroup.
                rest = collect("projeto", root)
                probe.side_effect = change_during_probe
                crossed = collect("projeto", root)
                probe.side_effect = None
                usage = collect("projeto", root)
                probe.side_effect = change_during_probe
                republished = collect("projeto", root)

        placement = dict(nginx_mode="existente", redis_mode="externo", local_services=["api"])
        other = [sample(p, {"api": 15}) for p in ("partida", "cabecalhos", "reinicio")]
        status, report = run_report("externo", [*other, rest, crossed, usage], 200, **placement)
        self.assertEqual(status, 0, report["failures"])
        self.assertEqual(report["phases"]["repouso"]["stack_peak_mib"], 30)
        self.assertEqual(report["phases"]["uso"]["stack_peak_mib"], 120)
        self.assertEqual(report["phases"]["repouso"]["complete_samples"], 1)
        self.assertEqual(report["phases"]["uso"]["complete_samples"], 1)
        self.assertEqual((crossed["phase"], crossed["phase_end"]), ("repouso", "uso"))
        self.assertEqual(crossed["containers"][0]["mib"], 120)
        crossing = report["phase_transitions"]["repouso → uso"]
        self.assertEqual(crossing["lines"], [5])
        self.assertEqual(crossing["complete_samples"], 0)
        self.assertIsNone(crossing["stack_peak_mib"])
        self.assertEqual(crossing["stack_peak_lower_bound_mib"], 120)
        self.assertEqual(sum(phase["samples"] for phase in report["phases"].values()) + crossing["samples"], 6)
        self.assertEqual(report["legacy_phase_samples"], 0)
        self.assertEqual((republished["phase"], republished["phase_end"]), ("uso", "uso"))
        self.assertTrue(republished["phase_changed"])
        status, same_names = run_report("externo", [*other, rest, republished, usage], 200, **placement)
        self.assertEqual(status, 0)
        self.assertEqual(same_names["phases"]["uso"]["complete_samples"], 1)
        self.assertEqual(same_names["phase_transitions"]["uso → uso"]["lines"], [5])

        status, short = run_report("externo", [*other, rest, crossed], 200, **placement)
        self.assertEqual(status, 1)
        self.assertTrue(any("uso" in err for err in short["failures"]))

        danger = {**crossed, "host_available_mib": 100, "host_oom_kill": 1, "neighbor_ok": False,
                  "containers": [{**crossed["containers"][0], "oom": 1, "limit_mib": None}]}
        low = {**rest, "containers": [{**rest["containers"][0], "limit_mib": 100}]}
        status, alerts = run_report("externo", [*other, low, danger, {**low, "phase": "uso", "phase_end": "uso"}],
                                    110, **placement)
        self.assertEqual(status, 1)
        self.assertEqual(alerts["host_oom_kill_delta"], 1)
        for diagnostic in ["margem", "OOM no cgroup", "memory.max", "sonda", "orçamento"]:
            self.assertTrue(any(diagnostic in err for err in alerts["failures"]), alerts["failures"])
        high_cap = {**crossed, "containers": [{**crossed["containers"][0], "limit_mib": 300}]}
        status, alerts = run_report("externo", [*other, rest, high_cap, usage], 200, **placement)
        self.assertEqual(status, 1)
        self.assertTrue(any("repouso → uso" in err and "300 MiB" in err for err in alerts["failures"]))

    def test_legacy_samples_check_the_cycle_without_proving_phase_coverage(self):
        placement = dict(nginx_mode="existente", redis_mode="externo", local_services=["api"])
        stable = [sample(p, {"api": 30}) for p in ("partida", "repouso", "uso", "cabecalhos", "reinicio")]
        legacy = [{k: v for k, v in row.items() if k != "phase_end"} for row in stable]
        status, report = run_report("externo", legacy, 100, **placement)
        self.assertEqual(status, 1)
        self.assertEqual(report["legacy_phase_samples"], len(legacy))
        self.assertFalse(report["phases"])
        self.assertTrue(all(t["complete_samples"] == 0 for t in report["phase_transitions"].values()))

        status, report = run_report("externo", [*stable, *legacy], 100, **placement)
        self.assertEqual(status, 0, report["failures"])
        self.assertTrue(all(t["complete_samples"] == 1 for t in report["phases"].values()))
        usage = legacy[2]
        usage.update(host_available_mib=100, host_oom_kill=1)
        usage["containers"] = [{"service": "api", "mib": 120, "limit_mib": None, "oom": 1, "oom_kill": 1}]
        status, report = run_report("externo", [*stable, usage], 100, **placement)
        self.assertEqual(status, 1)
        self.assertEqual(report["phases"]["uso"]["stack_peak_mib"], 30)
        for reason in ("orçamento ultrapassado", "margem do host", "memory.max", "OOM global", "OOM no cgroup"):
            self.assertTrue(any(reason in error for error in report["failures"]), report["failures"])

    def test_service_placement_and_missing_usage_cgroup(self):
        for db in ["local", "externo"]:
            for cache in ["local", "externo"]:
                for entry in ["local", "existente"]:
                    with self.subTest(cassandra=db, redis=cache, nginx=entry):
                        local = {"api": 15}
                        if db == "local":
                            local["cassandra"] = 30
                        if cache == "local":
                            local["redis"] = 4
                        if entry == "local":
                            local["nginx"] = 2
                        placement = dict(local_services=list(local), redis_mode=cache, nginx_mode=entry)
                        phases = ["partida", "repouso", "uso", "cabecalhos", "reinicio"]
                        if db == "local":
                            phases.append("compactacao")
                        rows = [sample(p, local) for p in phases]
                        status, report = run_report(db, rows, 500, **placement)
                        self.assertEqual(status, 0, report["failures"])
                        self.assertEqual(set(report["cgroup_limits_mib"]), set(local))
                        usage = report["phases"]["uso"]
                        self.assertEqual(usage["complete_samples"], 1)
                        self.assertEqual(usage["stack_peak_mib"], sum(local.values()))
                        self.assertEqual(usage["host_peak_mib"], 400)
                        self.assertEqual(usage["host_min_available_mib"], 500)

                        rows[2]["containers"] = [c for c in rows[2]["containers"] if c["service"] != "api"]
                        status, report = run_report(db, rows, 500, **placement)
                        self.assertEqual(status, 1)
                        self.assertIsNone(report["phases"]["uso"]["stack_peak_mib"])
                        self.assertTrue(any("uso" in reason for reason in report["failures"]))

    def test_declared_services_cannot_hide_a_local_role(self):
        phases = ["partida", "repouso", "uso", "cabecalhos", "reinicio"]
        for declared in [["nginx"], ["api"], ["api", "nginx", "redis"], ["api", "nginx", "nginx"]]:
            with self.subTest(declared=declared):
                values = {service: 15 for service in declared}
                rows = [sample(p, values) for p in phases]
                status, report = run_report("externo", rows, 500, local_services=declared,
                                            redis_mode="externo", nginx_mode="local")
                self.assertNotEqual(status, 0)
                self.assertTrue(any("local_services" in error for error in report["failures"]))

    def test_unexpected_cgroup_does_not_enter_project_peak(self):
        local = {"api": 15, "cassandra": 30}
        phases = ["partida", "repouso", "uso", "cabecalhos", "reinicio", "compactacao"]
        rows = [sample(p, local) for p in phases]
        rows[2] = sample("uso", {**local, "nginx": 2, "redis": 4})
        status, report = run_report("local", rows, 500, local_services=list(local),
                                    redis_mode="externo", nginx_mode="existente")
        self.assertEqual(status, 1)
        self.assertEqual(report["phases"]["uso"]["stack_peak_mib"], 45)
        self.assertEqual(set(report["phases"]["uso"]["service_peaks_mib"]), set(local))
        self.assertEqual(report["phases"]["uso"]["host_peak_mib"], 400)
        self.assertTrue(any("uso" in error and "cgroup" in error for error in report["failures"]))

    def test_hard_limits_during_each_sample(self):
        values = {"api": 15, "nginx": 2, "redis": 4}
        for api_limit, diagnostic in [(None, "api"), ("ausente", "api"), (220, "340 MiB"), (60, None)]:
            with self.subTest(api_limit=api_limit):
                rows = [sample(phase, values, 60) for phase in
                        ("partida", "repouso", "repouso", "uso", "cabecalhos", "reinicio")]
                api = next(c for c in rows[1]["containers"] if c["service"] == "api")
                if api_limit == "ausente":
                    del api["limit_mib"]
                else:
                    api["limit_mib"] = api_limit
                status, report = run_report("externo", rows, 250)
                self.assertEqual(report["cgroup_limits_mib"], dict.fromkeys(values, 60))
                if diagnostic is None:
                    self.assertEqual(status, 0, report["failures"])
                    self.assertEqual(report["phases"]["repouso"]["observed_limit_sum_peak_mib"], 180)
                else:
                    self.assertEqual(status, 1)
                    self.assertTrue(any("repouso" in error and diagnostic in error and "limit" in error
                                        for error in report["failures"]), report["failures"])
                    if api_limit == 220:
                        self.assertEqual(report["phases"]["repouso"]["observed_limit_sum_peak_mib"], 340)
                    else:
                        self.assertIsNone(report["phases"]["repouso"]["observed_limit_sum_peak_mib"])

    def test_limits_from_separate_samples_do_not_add_up(self):
        values = {"api": 15, "nginx": 2, "redis": 4}
        rows = [sample(phase, values, 60) for phase in
                ("partida", "repouso", "repouso", "uso", "cabecalhos", "reinicio")]
        rows[1]["containers"][0]["limit_mib"] = 130  # API
        rows[2]["containers"][1]["limit_mib"] = 130  # NGINX
        status, report = run_report("externo", rows, 250)
        self.assertEqual(status, 0, report["failures"])
        self.assertEqual(report["phases"]["repouso"]["observed_limit_sum_peak_mib"], 250)

    def test_missing_simultaneous_phase(self):
        for mode in ["local", "externo"]:
            for phase in ["repouso", "uso"]:
                with self.subTest(mode=mode, phase=phase):
                    status, data = summarize(mode, incomplete=phase)
                    self.assertNotEqual(status, 0)
                    self.assertTrue(any(phase in error for error in data["failures"]))
                    self.assertIsNone(data["phases"][phase]["stack_peak_mib"])
                    self.assertEqual(data["phases"][phase]["complete_samples"], 0)

    def test_partial_sum_above_complete_peak(self):
        for mode, complete_peak in [("local", 51), ("externo", 21)]:
            with self.subTest(mode=mode):
                status, data = summarize(mode, usage_partial_mib=72)
                self.assertNotEqual(status, 0)
                usage = data["phases"]["uso"]
                self.assertEqual(usage["stack_peak_lower_bound_mib"], 72)
                self.assertIsNone(usage["stack_peak_mib"])
                self.assertTrue(any("uso" in error and str(complete_peak) in error for error in data["failures"]))

    def test_simultaneous_peak_and_partial_transitions(self):
        for mode, expected_peak in [("local", 51), ("externo", 21)]:
            with self.subTest(mode=mode):
                status, data = summarize(mode)
                self.assertEqual(status, 0, data["failures"])
                for phase in ["repouso", "uso"]:
                    self.assertEqual(data["phases"][phase]["stack_peak_mib"], expected_peak)
                    self.assertEqual(data["phases"][phase]["stack_peak_lower_bound_mib"], expected_peak)
                    self.assertEqual(data["phases"][phase]["complete_samples"], 2)
                for phase in ["partida", "reinicio"]:
                    self.assertEqual(data["phases"][phase]["stack_peak_mib"], expected_peak)
                    self.assertEqual(data["phases"][phase]["complete_samples"], 1)


if __name__ == "__main__":
    unittest.main()
