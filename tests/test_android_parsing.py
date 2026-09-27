from perfhound.backends.android import _parse_framestats_fps


def test_framestats_fps_basic():
    # Two frames one second apart -> 1 fps.
    out = "line1\nline2\n" + "\n".join(
        [f"{1_000_000_000 + i * 1_000_000_000},a,b,c" for i in range(2)]
    )
    assert _parse_framestats_fps(out) == 1.0


def test_framestats_fps_too_few_frames_returns_none():
    out = "123,abc"
    assert _parse_framestats_fps(out) is None


def test_framestats_fps_ignores_headers():
    # Header lines like ---PROFILEDATA--- and non-numeric are skipped.
    out = "---PROFILEDATA---\n" + "\n".join(
        [f"{1_000_000_000 + i * 1_000_000_000},x,y" for i in range(3)]
    )
    # 3 frames spanning 2s -> 1 fps.
    assert _parse_framestats_fps(out) == 1.0


def test_framestats_fps_zero_span_returns_none():
    out = "1000000000,a\n1000000000,b"
    assert _parse_framestats_fps(out) is None
