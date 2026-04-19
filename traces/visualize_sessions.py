# /// script
# requires-python = ">=3.10"
# dependencies = ["matplotlib>=3.8"]
# ///
"""Visualize parsed IPM session data.

Generates PNG diagrams from the session-*.csv files produced by
ipm_parser.py. Output goes to docs/visualizations/.
"""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec


REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_DIR = REPO_ROOT / "specs" / "int" / "fixtures" / "ipm"
OUT_DIR = REPO_ROOT / "docs" / "visualizations"

SESSION_COLORS = {
    "session-short": "#2E86AB",
    "session-m1": "#A23B72",
    "session-m2-highpower": "#F18F01",
    "session-m3-long": "#C73E1D",
    "session-m4-level-changes": "#6A994E",
}

SESSION_LABELS = {
    "session-short": "short (L3, ~21 strokes)",
    "session-m1": "M1 (L3, 20 strokes, 163m)",
    "session-m2-highpower": "M2 high-power (L3, 635W peak)",
    "session-m3-long": "M3 long (L3, 1035m, 4:44)",
    "session-m4-level-changes": "M4 level changes (L1→L4)",
}


def load_session(name: str) -> list[dict]:
    path = CSV_DIR / f"{name}.csv"
    with path.open() as f:
        return [
            {
                "time_sec": float(r["time_sec"]),
                "distance_m": int(r["distance_m"]),
                "spm": int(r["spm"]),
                "power_w": int(r["power_w"]),
                "cal_per_hr": int(r["cal_per_hr"]),
                "level": int(r["level"]),
                "unknown_13_16": int(r["unknown_13_16"]),
            }
            for r in csv.DictReader(f)
        ]


def style_axis(ax, title: str, xlabel: str, ylabel: str) -> None:
    ax.set_title(title, fontsize=11, fontweight="bold")
    ax.set_xlabel(xlabel, fontsize=9)
    ax.set_ylabel(ylabel, fontsize=9)
    ax.grid(True, alpha=0.3, linestyle="--")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def plot_power_time_all_sessions(sessions: dict) -> None:
    fig, ax = plt.subplots(figsize=(12, 6))
    for name, rows in sessions.items():
        xs = [r["time_sec"] for r in rows]
        ys = [r["power_w"] for r in rows]
        ax.plot(xs, ys, "o-", label=SESSION_LABELS[name],
                color=SESSION_COLORS[name], alpha=0.85, markersize=5, linewidth=1.8)
    style_axis(ax, "Power Output Over Time — All Sessions",
               "Elapsed rowing time (s)", "Power (W)")
    ax.legend(loc="upper left", frameon=True, fontsize=9)
    ax.axhline(y=0, color="black", linewidth=0.5)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "01-power-all-sessions.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_m4_level_changes(sessions: dict) -> None:
    rows = sessions["session-m4-level-changes"]
    fig = plt.figure(figsize=(13, 8))
    gs = GridSpec(3, 1, figure=fig, hspace=0.35, height_ratios=[2, 2, 1.2])

    times = [r["time_sec"] for r in rows]
    powers = [r["power_w"] for r in rows]
    spms = [r["spm"] for r in rows]
    levels = [r["level"] for r in rows]

    level_colors = {1: "#90E0EF", 2: "#0096C7", 3: "#0077B6", 4: "#023E8A"}

    ax1 = fig.add_subplot(gs[0])
    for i in range(len(rows) - 1):
        ax1.fill_between([times[i], times[i + 1]], 0, max(powers) * 1.1,
                         color=level_colors.get(levels[i], "gray"), alpha=0.25)
    ax1.plot(times, powers, "o-", color="#C73E1D", linewidth=2.2, markersize=7)
    style_axis(ax1, "M4: Power Output vs Level Changes",
               "", "Power (W)")
    ax1.set_ylim(0, max(powers) * 1.1)

    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    for i in range(len(rows) - 1):
        ax2.fill_between([times[i], times[i + 1]], 0, max(spms) * 1.1,
                         color=level_colors.get(levels[i], "gray"), alpha=0.25)
    ax2.plot(times, spms, "s-", color="#6A994E", linewidth=2.2, markersize=7)
    style_axis(ax2, "M4: Stroke Rate (SPM) vs Level Changes",
               "", "SPM")
    ax2.set_ylim(0, max(spms) * 1.15)

    ax3 = fig.add_subplot(gs[2], sharex=ax1)
    ax3.step(times, levels, where="post", color="#023E8A", linewidth=2.5)
    ax3.fill_between(times, 0, levels, step="post", alpha=0.25, color="#023E8A")
    style_axis(ax3, "M4: Resistance Level (decoded from footer[25:27])",
               "Elapsed rowing time (s)", "Level")
    ax3.set_ylim(0, 5)
    ax3.set_yticks([0, 1, 2, 3, 4])

    legend_patches = [mpatches.Patch(color=level_colors[lv], alpha=0.5,
                                      label=f"Level {lv}") for lv in sorted(level_colors)]
    ax1.legend(handles=legend_patches, loc="upper left", ncol=4, fontsize=9, frameon=True)

    fig.suptitle("M4 Level-Change Session: Power & SPM Response to Resistance Steps",
                 fontsize=13, fontweight="bold", y=0.995)
    fig.savefig(OUT_DIR / "02-m4-level-impact.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_m3_long_session(sessions: dict) -> None:
    rows = sessions["session-m3-long"]
    times = [r["time_sec"] for r in rows]
    powers = [r["power_w"] for r in rows]
    spms = [r["spm"] for r in rows]
    distances = [r["distance_m"] for r in rows]

    fig = plt.figure(figsize=(14, 9))
    gs = GridSpec(3, 1, figure=fig, hspace=0.3)

    ax1 = fig.add_subplot(gs[0])
    ax1.plot(times, distances, color="#C73E1D", linewidth=2.2)
    ax1.fill_between(times, 0, distances, alpha=0.15, color="#C73E1D")
    ax1.axhline(y=1000, color="red", linestyle="--", linewidth=1, alpha=0.5)
    ax1.text(times[-1], 1000, " 1000m → distance field stays 4 digits",
             fontsize=8, va="bottom", ha="right", color="red", alpha=0.8)
    style_axis(ax1, "M3 Long Session: Distance over 4:44",
               "", "Distance (m)")

    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax2.plot(times, powers, color="#A23B72", linewidth=1.5, alpha=0.85)
    # Moving average
    window = 5
    if len(powers) >= window:
        ma = [sum(powers[max(0, i - window + 1):i + 1]) / min(i + 1, window)
              for i in range(len(powers))]
        ax2.plot(times, ma, color="#2E1433", linewidth=2.5, label=f"{window}-sample avg")
        ax2.legend(loc="upper right", fontsize=9)
    style_axis(ax2, "M3: Power over time (with moving average)",
               "", "Power (W)")

    ax3 = fig.add_subplot(gs[2], sharex=ax1)
    ax3.plot(times, spms, color="#6A994E", linewidth=1.5, alpha=0.85)
    style_axis(ax3, "M3: Stroke Rate (SPM)",
               "Elapsed time (s)", "SPM")

    fig.suptitle("M3: Full 1035m Session Breakdown", fontsize=14, fontweight="bold", y=0.995)
    fig.savefig(OUT_DIR / "03-m3-long-breakdown.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_power_and_calories_dual_axis(sessions: dict) -> None:
    """Power and calories/hour over time, per session, with dual y-axes."""
    fig, axes = plt.subplots(len(sessions), 1, figsize=(13, 3.2 * len(sessions)),
                              sharex=False)
    if len(sessions) == 1:
        axes = [axes]

    for ax, (name, rows) in zip(axes, sessions.items()):
        times = [r["time_sec"] for r in rows]
        powers = [r["power_w"] for r in rows]
        cals = [r["cal_per_hr"] for r in rows]

        color_p = SESSION_COLORS[name]
        color_c = "#000000"

        ax.plot(times, powers, "o-", color=color_p,
                markersize=4, linewidth=1.8, label="Power (W)")
        ax.set_ylabel("Power (W)", color=color_p, fontsize=10)
        ax.tick_params(axis="y", labelcolor=color_p)
        ax.grid(True, alpha=0.3, linestyle="--")
        ax.spines["top"].set_visible(False)

        ax2 = ax.twinx()
        ax2.plot(times, cals, "s--", color=color_c,
                 markersize=3, linewidth=1.2, alpha=0.7, label="Cal/hr")
        ax2.set_ylabel("Calories / hour", color=color_c, fontsize=10)
        ax2.tick_params(axis="y", labelcolor=color_c)
        ax2.spines["top"].set_visible(False)

        ax.set_title(SESSION_LABELS[name], fontsize=11, fontweight="bold")
        ax.set_xlabel("Elapsed rowing time (s)", fontsize=9)

        # Combined legend
        lines_1, labels_1 = ax.get_legend_handles_labels()
        lines_2, labels_2 = ax2.get_legend_handles_labels()
        ax.legend(lines_1 + lines_2, labels_1 + labels_2,
                  loc="upper left", fontsize=8, frameon=True)

    fig.suptitle("Power (W) and Calories/Hour Over Time — Per Session (Dual Y-Axes)",
                 fontsize=13, fontweight="bold", y=0.999)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "07-power-calories-dual-axis.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_power_to_derived_metric(sessions: dict) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))

    for name, rows in sessions.items():
        active = [r for r in rows if r["spm"] > 0]
        xs = [r["power_w"] for r in active]
        ys = [r["cal_per_hr"] // 10 for r in active]
        ax1.scatter(xs, ys, label=SESSION_LABELS[name],
                    color=SESSION_COLORS[name], s=35, alpha=0.7, edgecolors="black",
                    linewidth=0.4)

    # Show the fit: f(W) ≈ 3.05 * W^0.66
    import numpy as np
    ws = np.linspace(40, 700, 200)
    fit = 3.05 * ws ** 0.66
    ax1.plot(ws, fit, "k--", linewidth=1.5, alpha=0.6, label="fit: 3.05·W^0.66")

    style_axis(ax1, "Derived Metric [21:24] vs Power",
               "Power (W)", "Footer[21:24] value")
    ax1.legend(loc="upper left", fontsize=8)

    # Log-log version
    for name, rows in sessions.items():
        active = [r for r in rows if r["spm"] > 0 and r["power_w"] > 0 and r["cal_per_hr"] // 10 > 0]
        xs = [r["power_w"] for r in active]
        ys = [r["cal_per_hr"] // 10 for r in active]
        ax2.scatter(xs, ys, color=SESSION_COLORS[name], s=35, alpha=0.7,
                    edgecolors="black", linewidth=0.4)
    ax2.plot(ws, fit, "k--", linewidth=1.5, alpha=0.6)
    ax2.set_xscale("log")
    ax2.set_yscale("log")
    style_axis(ax2, "Same relationship on log-log axes (straight line = power law)",
               "Power (W, log)", "Footer[21:24] (log)")

    fig.suptitle("Unknown Footer[21:24] is a Power Law of Watts",
                 fontsize=13, fontweight="bold", y=1.00)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "04-derived-metric-vs-power.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_distance_vs_time_pace(sessions: dict) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))

    for name, rows in sessions.items():
        times = [r["time_sec"] for r in rows]
        dists = [r["distance_m"] for r in rows]
        ax1.plot(times, dists, "o-", color=SESSION_COLORS[name],
                 label=SESSION_LABELS[name], markersize=4, linewidth=1.5, alpha=0.85)

    style_axis(ax1, "Distance accumulation vs time",
               "Elapsed time (s)", "Distance (m)")
    ax1.legend(loc="upper left", fontsize=8)

    # Pace visualization (derived m/s from consecutive samples)
    for name, rows in sessions.items():
        if len(rows) < 2:
            continue
        paces = []
        pt = []
        for i in range(1, len(rows)):
            dt = rows[i]["time_sec"] - rows[i - 1]["time_sec"]
            dd = rows[i]["distance_m"] - rows[i - 1]["distance_m"]
            if dt > 0:
                paces.append(dd / dt)
                pt.append(rows[i]["time_sec"])
        if paces:
            ax2.plot(pt, paces, "-", color=SESSION_COLORS[name],
                     label=SESSION_LABELS[name], linewidth=1.5, alpha=0.8)

    style_axis(ax2, "Instantaneous pace (m/s) — derived from Δdistance/Δtime",
               "Elapsed time (s)", "Pace (m/s)")
    ax2.legend(loc="upper right", fontsize=8)

    fig.suptitle("Distance & Pace Profiles Across All Sessions",
                 fontsize=13, fontweight="bold", y=1.0)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "05-distance-pace.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_message_structure_diagram() -> None:
    """Visual schematic of the A8 message layout."""
    fig, ax = plt.subplots(figsize=(14, 5.5))
    ax.set_xlim(0, 30)
    ax.set_ylim(0, 10)
    ax.axis("off")

    fields = [
        ("A8", 0, 2, "#555555", "white", "prefix", ""),
        ("MMMSST", 2, 6, "#2E86AB", "white", "[0:6] time", "min·sec·tenths"),
        ("DDDD",   8, 4, "#A23B72", "white", "[6:10] distance", "metres, 0-9999"),
        ("MRK",   12, 3, "#888888", "white", "[10:13] marker", "usually 102"),
        ("???",   15, 3, "#DDDDDD", "black", "[13:16] ?", "unknown"),
        ("SS",    18, 2, "#6A994E", "white", "[16:18] SPM", "strokes/min"),
        ("PPP",   20, 3, "#F18F01", "white", "[18:21] power", "watts"),
        ("CCC",   23, 3, "#C73E1D", "white", "[21:24] derived", "≈3·W^0.66"),
        ("X",     26, 1, "#DDDDDD", "black", "[24:25] ?", "unknown"),
        ("LL",    27, 2, "#023E8A", "white", "[25:27] level", "01-16"),
    ]

    for text, x, w, bg, fg, caption, sub in fields:
        rect = mpatches.FancyBboxPatch((x, 4), w, 2,
                                        boxstyle="round,pad=0.05",
                                        facecolor=bg, edgecolor="black", linewidth=1)
        ax.add_patch(rect)
        ax.text(x + w / 2, 5, text, ha="center", va="center",
                fontsize=12, fontweight="bold", color=fg)
        ax.text(x + w / 2, 3.3, caption, ha="center", va="center", fontsize=8, color="black")
        if sub:
            ax.text(x + w / 2, 2.6, sub, ha="center", va="center",
                    fontsize=7, color="#555555", style="italic")

    # Example decode at bottom
    ax.text(0.5, 9.3, "A8 live-data message (27 digits + 2-byte A8 prefix)",
            fontsize=14, fontweight="bold")
    ax.text(0.5, 8.6, "Example: A8004440103510222000249008303  →  4:44.0, 1035m, SPM 0, 249W, level 3",
            fontsize=10, color="#333333", style="italic")

    ax.text(0.5, 1.5, "Verified fields are colored; gray fields are known in position but unknown in meaning.",
            fontsize=9, color="#555555", style="italic")

    fig.savefig(OUT_DIR / "00-message-structure.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def plot_power_distribution(sessions: dict) -> None:
    fig, ax = plt.subplots(figsize=(12, 6))
    all_powers = []
    for name, rows in sessions.items():
        active = [r["power_w"] for r in rows if r["spm"] > 0]
        if active:
            ax.hist(active, bins=25, alpha=0.55, label=SESSION_LABELS[name],
                    color=SESSION_COLORS[name], edgecolor="black", linewidth=0.3)
            all_powers.extend(active)

    style_axis(ax, "Power distribution across sessions (active rowing only)",
               "Power (W)", "Message count")
    ax.legend(loc="upper right", fontsize=9)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "06-power-distribution.png", dpi=140, bbox_inches="tight")
    plt.close(fig)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sessions = {name: load_session(name) for name in SESSION_COLORS}

    plot_message_structure_diagram()
    plot_power_time_all_sessions(sessions)
    plot_m4_level_changes(sessions)
    plot_m3_long_session(sessions)
    plot_power_to_derived_metric(sessions)
    plot_distance_vs_time_pace(sessions)
    plot_power_distribution(sessions)
    plot_power_and_calories_dual_axis(sessions)

    print(f"Wrote visualizations to {OUT_DIR.relative_to(REPO_ROOT)}/")
    for p in sorted(OUT_DIR.glob("*.png")):
        size_kb = p.stat().st_size // 1024
        print(f"  {p.name}  ({size_kb} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
