from perfhound.errors import DeviceNotFoundError
from perfhound.model import Metric
from perfhound.backends.android import AndroidCollector


class FakeRunner:
    def __init__(self, outputs):
        self.outputs = outputs
        self.calls = []

    def run(self, command, timeout=None):
        self.calls.append(command)
        key = " ".join(command)
        if key in self.outputs:
            return self.outputs[key]
        raise AssertionError(f"unexpected command: {key}")


def _stat_line(utime=10, stime=5):
    # fields: 1 pid, 2 comm, 3 state, 4-13 filler (10 fields), 14 utime, 15 stime
    return "123 (com.example) S " + " ".join(["0"] * 10) + f" {utime} {stime}"


def test_cpu_delta_between_samples():
    runner = FakeRunner(
        {
            "adb -s dev shell pidof com.example": "123\n",
            "adb -s dev shell cat /proc/123/stat": _stat_line(10, 5),
        }
    )
    collector = AndroidCollector(runner, "dev", "com.example", (Metric.CPU,), now=lambda: 0.0)

    # reset primes last_cpu -> (10+5)*10 = 150ms
    collector.reset()

    runner.outputs["adb -s dev shell cat /proc/123/stat"] = _stat_line(20, 10)  # 300ms
    sample = collector.sample()
    # delta = 300 - 150 = 150ms
    assert sample.cpu_time_ms == 150.0


def test_pid_not_found_raises():
    runner = FakeRunner({"adb -s dev shell pidof com.example": "\n"})
    try:
        AndroidCollector(runner, "dev", "com.example", (Metric.CPU,))
        raise AssertionError("expected DeviceNotFoundError")
    except DeviceNotFoundError:
        pass


def test_memory_mb_parsing():
    meminfo = (
        "Applications Memory Usage (in Kilobytes):\n"
        "Uptime: 123 Realtime: 456\n"
        "        TOTAL  216524  208232  4384  0  82916  68345  14570\n"
    )
    runner = FakeRunner(
        {
            "adb -s dev shell pidof com.example": "123\n",
            "adb -s dev shell dumpsys meminfo com.example": meminfo,
        }
    )
    collector = AndroidCollector(runner, "dev", "com.example", (Metric.MEMORY,), now=lambda: 0.0)
    sample = collector.sample()
    # 216524 kB -> MB
    assert abs(sample.memory_mb - 211.449) < 0.01
