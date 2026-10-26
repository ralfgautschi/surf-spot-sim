"""Linear wave theory helpers (vectorised)."""
from __future__ import annotations

import numpy as np

G = 9.81


def wavenumber(T, h):
    """Wavenumber k (rad/m) for period T (s) and depth h (m); Guo (2002) explicit approximation (<0.75 % error)."""
    T = np.asarray(T, dtype=float)
    h = np.maximum(np.asarray(h, dtype=float), 1e-3)
    omega = 2 * np.pi / T
    k0h = omega**2 * h / G
    kh = k0h * (1 - np.exp(-(k0h ** 1.25))) ** -0.4
    return kh / h


def celerity(T, h):
    """Phase speed c and group speed cg (m/s)."""
    k = wavenumber(T, h)
    h = np.maximum(np.asarray(h, dtype=float), 1e-3)
    omega = 2 * np.pi / np.asarray(T, dtype=float)
    c = omega / k
    kh = k * h
    n = 0.5 * (1 + 2 * kh / np.sinh(np.minimum(2 * kh, 700)))
    return c, n * c


def shoaling_coefficient(T, h, h_ref=None):
    """Ks = sqrt(cg_ref / cg); h_ref=None means deep water."""
    _, cg = celerity(T, h)
    cg_ref = G * np.asarray(T, dtype=float) / (4 * np.pi) if h_ref is None else celerity(T, h_ref)[1]
    return np.sqrt(cg_ref / cg)
