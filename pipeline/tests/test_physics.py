import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from grid import Grid  # noqa: E402
from raytrace import OFFSHORE, SpeedField, trace  # noqa: E402
from transfer import apply, ray_map  # noqa: E402
from waves import G, celerity, wavenumber  # noqa: E402


def test_dispersion_limits():
    T = 12.0
    L0 = G * T**2 / (2 * np.pi)
    assert 2 * np.pi / wavenumber(T, 1000.0) == pytest.approx(L0, rel=1e-3)
    c, cg = celerity(T, 0.5)
    assert c == pytest.approx(np.sqrt(G * 0.5), rel=0.02)
    assert cg == pytest.approx(c, rel=0.02)


def test_flat_bottom_returns_input_unchanged():
    # 30 m deep everywhere below MSL (z0=2 → z=-28 LAT); rays stay straight
    g = Grid.synthetic(lambda X, Y: np.full_like(X, -28.0))
    rm = ray_map(g, 0.0, 0.0, 180.0, 12.0)
    ok = np.isfinite(rm["offshore"])
    assert ok.all()
    d = (rm["offshore"] - rm["local"] + 180) % 360 - 180
    assert np.abs(d).max() < 0.01
    assert np.allclose(rm["ratio"], 1.0, atol=1e-6)
    K, mean_local = apply(rm, 200.0, 15.0)
    assert K == pytest.approx(1.0, abs=0.01)
    assert mean_local == pytest.approx(200.0, abs=0.5)


def test_plane_beach_obeys_snell():
    # seabed deepening to the south: depth = 2 + 0.01*(-y) below MSL, straight contours along x
    g = Grid.synthetic(lambda X, Y: -(0.01 * np.maximum(-Y, 0) + 2.0) + 2.0, ymin=-9000, ymax=0, xmin=-12000, xmax=12000)
    T = 10.0
    x0, y0 = 0.0, -1000.0  # 12 m deep
    f = SpeedField(T, g)
    r = trace(f, x0, y0, [200.0], offshore_depth=60.0)
    assert r["status"][0] == OFFSHORE
    c0 = f.at(np.array([x0]), np.array([y0]))[0][0]
    c1 = f.at(r["x"], r["y"])[0][0]
    # Snell: sin(angle to the normal)/c conserved; normal points south (180)
    a0 = np.radians(200.0 - 180.0)
    a1 = np.radians(r["heading"][0] - 180.0)
    assert np.sin(a1) / c1 == pytest.approx(np.sin(a0) / c0, rel=0.02)
    assert np.degrees(a1) > 20.0  # more oblique offshore


def test_headland_blocks_westerly_swell():
    # south-facing beach with a headland wall running south from x=-2000 (land west of it, out to y=-6000)
    def z(X, Y):
        depth = 2.0 + 0.01 * np.maximum(-Y, 0)
        zz = 2.0 - depth
        return np.where((X < -2000) & (Y > -6000), 5.0, zz)

    g = Grid.synthetic(z, xmin=-8000, xmax=8000, ymin=-12000, ymax=0)
    rm = ray_map(g, 0.0, -800.0, 180.0, 12.0)
    K_s, _ = apply(rm, 190.0, 12.0)
    K_w, _ = apply(rm, 265.0, 12.0)
    assert K_w < 0.5 * K_s


TABLES = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "transfer"


@pytest.mark.skipif(not TABLES.exists(), reason="run build_tables.py first")
@pytest.mark.parametrize("spot", ["fortaleza", "chico-times", "rocha-negra"])
def test_luz_tables_cut_westerly_swell(spot):
    import json

    t = json.loads((TABLES / f"{spot}.json").read_text())
    p = next(p for p in t["periods"] if p["T"] == 12)
    f = lambda a: np.array([np.nan if v is None else v for v in a], dtype=float)  # noqa: E731
    rm = {"local": f(p["local"]), "offshore": f(p["offshore"]), "ratio": f(p["ratio"])}
    K_s, _ = apply(rm, 200.0, 15.0)
    K_w, _ = apply(rm, 275.0, 15.0)
    assert 0.7 < K_s < 1.3
    assert K_w < 0.25 * K_s
