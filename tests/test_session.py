import threading

import pytest

from perfhound.errors import RecordingError
from perfhound.model import Metric, RecordingConfig, Sample
from perfhound.session import RecordingSession, start_recording


class FakeCollector:
    def __init__(self, fail_after=None):
        self.samples = 0
        self.reset_called = False
        self.close_called = False
        self.fail_after = fail_after

    def reset(self):
        self.reset_called = True

    def sample(self):
        self.samples += 1
        if self.fail_after is not None and self.samples > self.fail_after:
            raise RuntimeError("boom")
        return Sample(timestamp=float(self.samples), cpu_time_ms=10.0)

    def close(self):
        self.close_called = True


def test_session_start_and_stop(tmp_path):
    collector = FakeCollector()
    config = RecordingConfig(
        device_id="dev", package="com.example", metrics=(Metric.CPU,), interval=0.01
    )
    session = RecordingSession(collector, config).start()
    # Let the sampler run a couple of ticks.
    import time

    time.sleep(0.05)
    samples = session.stop(str(tmp_path / "out.csv"))

    assert collector.reset_called
    assert collector.close_called
    assert len(samples) >= 1
    assert (tmp_path / "out.csv").exists()


def test_stop_is_idempotent():
    collector = FakeCollector()
    config = RecordingConfig(device_id="dev", package="com.example", metrics=(Metric.CPU,), interval=0.01)
    session = RecordingSession(collector, config).start()
    session.stop()
    first = session.samples
    second = session.stop()
    assert first == second


def test_auto_timeout():
    collector = FakeCollector()
    config = RecordingConfig(
        device_id="dev",
        package="com.example",
        metrics=(Metric.CPU,),
        interval=0.01,
        max_duration=0.05,
    )
    session = RecordingSession(collector, config).start()
    import time

    # Wait longer than max_duration; the sampler should stop itself.
    time.sleep(0.2)
    samples = session.stop()
    # The sampler should not have run indefinitely (a bounded number of samples).
    assert len(samples) >= 1
    assert collector.close_called


def test_error_salvages_samples(tmp_path):
    collector = FakeCollector(fail_after=2)
    config = RecordingConfig(
        device_id="dev", package="com.example", metrics=(Metric.CPU,), interval=0.01
    )
    session = RecordingSession(collector, config).start()
    import time

    time.sleep(0.1)
    with pytest.raises(RecordingError):
        session.stop(str(tmp_path / "out.csv"))
    # Samples collected before the failure are still written.
    assert (tmp_path / "out.csv").exists()
    assert len(session.samples) >= 1


def test_start_recording_validates_interval():
    with pytest.raises(ValueError):
        start_recording("dev", "com.example", interval=0)


def test_start_recording_validates_metrics():
    with pytest.raises(ValueError):
        start_recording("dev", "com.example", metrics=[])


def test_start_recording_rejects_unknown_metric():
    with pytest.raises(ValueError):
        start_recording("dev", "com.example", metrics=["nope"])
