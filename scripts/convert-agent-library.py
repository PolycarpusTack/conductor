#!/usr/bin/env python3
"""Converts the ClaudeExtras agent suites + chain catalog into Conductor's
bundled agent library (src/lib/server/agent-library/library.json).

One-time/occasional tooling — the JSON artifact is what ships. Re-run with:
    python scripts/convert-agent-library.py [path-to-ClaudeExtras]
"""

import io
import json
import re
import sys
import zipfile
from pathlib import Path

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Projects\ClaudeExtras")
OUT = Path(__file__).resolve().parents[1] / "src" / "lib" / "server" / "agent-library" / "library.json"

# Suite → category, emoji, color. Specific suites win over master-suite for
# duplicated agents; master-only leftovers are Craftsmanship.
SUITES = {
    "ddd-full-suite": ("Domain-Driven Design", "📐", "#A78BFA"),
    "master-suite": ("Craftsmanship", "🛠️", "#F59E0B"),
    "architecture-suite": ("Architecture", "🏛️", "#60A5FA"),
    "devops-suite": ("DevOps & Delivery", "🚀", "#4ADE80"),
    "dev-planning-suite": ("Planning & Discovery", "🗺️", "#2DD4BF"),
    "engineering-leadership-suite": ("Engineering Leadership", "🧭", "#F87171"),
    "security-engineering-suite": ("Security", "🛡️", "#FB7185"),
    "sre-observability-suite": ("SRE & Observability", "📡", "#38BDF8"),
    "testing-strategy-suite": ("Testing", "🧪", "#A3E635"),
}
CORE_CATEGORY = ("Orchestration", "🎼", "#9BAAC4")
API_CATEGORY = ("API Testing", "🔌", "#FBBF24")

# Suite priority for dedupe: every non-master suite beats master.
SUITE_PRIORITY = {name: (1 if name == "master-suite" else 0) for name in SUITES}

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", re.DOTALL)


def parse_frontmatter(text):
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, m.group(2).strip()


def mode_for_slug(slug):
    if re.search(r"-(reviewer|guard|auditor|detector|evaluator|enforcer|validator)$", slug):
        return "review"
    if re.search(r"-(generator|builder|gen|recorder|writer)$", slug):
        return "draft"
    return "analyze"


def collect_zip_agents():
    """89 unique frontmatter agents from YannickAgents.zip suites."""
    agents = {}
    with zipfile.ZipFile(SOURCE / "YannickAgents.zip") as z:
        for name in z.namelist():
            parts = name.split("/")
            if len(parts) < 4 or parts[1] != ".claude" or parts[2] != "agents" or not name.endswith(".md"):
                continue
            suite = parts[0]
            if suite not in SUITES:
                continue
            slug = parts[-1][:-3]
            existing = agents.get(slug)
            if existing and SUITE_PRIORITY[existing["_suite"]] <= SUITE_PRIORITY[suite]:
                continue  # keep the more specific suite's copy
            text = z.read(name).decode("utf-8", errors="replace")
            meta, body = parse_frontmatter(text)
            if not meta or "name" not in meta:
                print(f"  ! no frontmatter: {name}")
                continue
            category, emoji, color = SUITES[suite]
            agents[slug] = {
                "_suite": suite,
                "name": meta["name"],
                "category": category,
                "emoji": emoji,
                "color": color,
                "role": meta["name"],
                "description": meta.get("description", "")[:480],
                "systemPrompt": body,
            }
    return agents


def collect_core_agents(agents):
    """gpm-partner, backlog-builder, current-state-evaluator (frontmatter) +
    output-evaluator (plain prompt doc, wrapped)."""
    category, emoji, color = CORE_CATEGORY
    core = SOURCE / "core"
    for fname in ["gpm-partner-agent-v2.md", "backlog-builder-agent-v2.md", "current-state-evaluator-agent.md"]:
        path = core / fname
        if not path.exists():
            continue
        meta, body = parse_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        if not meta or "name" not in meta:
            print(f"  ! no frontmatter: {fname}")
            continue
        slug = meta["name"]
        agents[slug] = {
            "_suite": "core", "name": slug, "category": category, "emoji": emoji,
            "color": color, "role": slug,
            "description": meta.get("description", "")[:480], "systemPrompt": body,
        }
    # output-evaluator: plain paste-prompt, chains reference it heavily
    oe = core / "output-evaluation-prompt.md"
    if oe.exists():
        body = oe.read_text(encoding="utf-8", errors="replace")
        agents["output-evaluator"] = {
            "_suite": "core", "name": "output-evaluator", "category": category,
            "emoji": emoji, "color": color, "role": "output-evaluator",
            "description": "Structured quality review of the previous step's output: scope, accuracy, code quality, planning quality. Rigorous and specific — names exact locations and cited principles.",
            "systemPrompt": body,
        }
    # chains say `output-evaluator` and `current-state-evaluator` and `gpm`
    return agents


def collect_api_agents(agents):
    """5 ROLE:-block agents from api-testing-suite/agents/all-agents.md."""
    category, emoji, color = API_CATEGORY
    path = SOURCE / "api-testing-suite" / "agents" / "all-agents.md"
    if not path.exists():
        return agents
    text = path.read_text(encoding="utf-8", errors="replace")
    # Sections: "## Agent N: Title" then "**File:** `slug.md`" then ```prompt```
    for m in re.finditer(
        r"## Agent \d+: (?P<title>[^\n]+)\n\*\*File:\*\* `(?P<file>[a-z0-9-]+)\.md`\s*\n+```\n(?P<prompt>.*?)```",
        text, re.DOTALL,
    ):
        slug = m.group("file").removesuffix("-agent")
        role_line = next((l for l in m.group("prompt").splitlines() if l.startswith("ROLE:")), "")
        agents[slug] = {
            "_suite": "api-testing-suite", "name": slug, "category": category,
            "emoji": emoji, "color": color, "role": slug,
            "description": (role_line.removeprefix("ROLE:").strip() or m.group("title").strip())[:480],
            "systemPrompt": m.group("prompt").strip(),
        }
    return agents


SLUG_LINE = re.compile(r"^([a-z][a-z0-9-]{3,})\s*(?:←\s*\"(.*?)\")?\s*$")
NUMBERED_SLUG = re.compile(r"^\s*\d+\.\s+([a-z][a-z0-9-]{3,})\s*$")


def steps_from_fence(fence, known):
    """Parse a chain code fence into ordered (slug, instruction) pairs."""
    steps = []
    for raw in fence.splitlines():
        line = raw.rstrip()
        m = SLUG_LINE.match(line) or NUMBERED_SLUG.match(line)
        if not m:
            continue
        slug = m.group(1)
        if slug not in known:
            continue  # box-art / prose fragments / unknown refs are skipped
        instruction = (m.group(2) or "").strip() if m.re is SLUG_LINE else ""
        steps.append({"agentRole": slug, "mode": mode_for_slug(slug),
                      "instructions": instruction, "autoContinue": True})
    return steps


def parse_main_catalog(known, unknown_report):
    chains = []
    text = (SOURCE / "agent-chain-catalog.md").read_text(encoding="utf-8", errors="replace")
    # Split on "## N. Title" sections
    sections = re.split(r"\n## (\d+)\. ", text)
    for i in range(1, len(sections), 2):
        body = sections[i + 1]
        title = body.split("\n", 1)[0].strip()
        section_body = body
        goal = ""
        gm = re.search(r"\*\*Goal:\*\* ([^\n]+)", section_body)
        if gm:
            goal = gm.group(1).strip()

        # subsections (### 3a. …) become their own chains
        subsections = re.split(r"\n### \d+[a-z]\. ", section_body)
        if len(subsections) > 1:
            for sub in subsections[1:]:
                sub_title = sub.split("\n", 1)[0].strip()
                fences = re.findall(r"```\n(.*?)```", sub, re.DOTALL)
                steps = steps_from_fence("\n".join(fences), known)
                if steps:
                    chains.append({"name": sub_title, "icon": "⛓️", "description": goal, "steps": steps})
            continue

        fences = re.findall(r"```\n(.*?)```", section_body, re.DOTALL)
        steps = steps_from_fence("\n".join(fences), known)
        # track unknown slugs for the report
        for raw in "\n".join(fences).splitlines():
            m = SLUG_LINE.match(raw.rstrip())
            if m and m.group(1) not in known and "-" in m.group(1):
                unknown_report.add(m.group(1))
        if steps:
            chains.append({"name": title, "icon": "⛓️", "description": goal, "steps": steps})
    return chains


def parse_patch(path, known, unknown_report):
    chains = []
    if not path.exists():
        return chains
    text = path.read_text(encoding="utf-8", errors="replace")
    new_section = re.split(r"\n## (?:NEW CHAINS.*|UPDATED.*|UPDATES.*)\n", text)
    body = new_section[1] if len(new_section) > 1 else text
    # stop at the updates section if present
    body = re.split(r"\n## (?:UPDATED|UPDATES|EXISTING)", body)[0]
    for m in re.finditer(r"### Chain \d+ — (?P<title>[^\n]+)\n(?P<body>.*?)(?=\n### Chain |\Z)", body, re.DOTALL):
        purpose = ""
        pm = re.search(r"\*\*Purpose:\*\* ([^\n]+)", m.group("body"))
        if pm:
            purpose = pm.group(1).strip()
        fences = re.findall(r"```\n(.*?)```", m.group("body"), re.DOTALL)
        steps = steps_from_fence("\n".join(fences), known)
        for raw in "\n".join(fences).splitlines():
            nm = NUMBERED_SLUG.match(raw.rstrip())
            if nm and nm.group(1) not in known:
                unknown_report.add(nm.group(1))
        if steps:
            chains.append({"name": m.group("title").strip(), "icon": "⛓️", "description": purpose, "steps": steps})
    return chains


def main():
    print(f"source: {SOURCE}")
    agents = collect_zip_agents()
    agents = collect_core_agents(agents)
    agents = collect_api_agents(agents)
    known = set(agents.keys())
    print(f"agents: {len(agents)}")

    unknown = set()
    chains = parse_main_catalog(known, unknown)
    chains += parse_patch(SOURCE / "agent-chain-catalog-suite5-patch.md", known, unknown)
    chains += parse_patch(SOURCE / "agent-chain-catalog-suite8-patch.md", known, unknown)
    # dedupe chains by name (patches re-state chains)
    seen, unique_chains = set(), []
    for c in chains:
        if c["name"].lower() in seen:
            continue
        if len(c["steps"]) < 3:
            print(f"  ! dropped thin chain ({len(c['steps'])} steps): {c['name']}")
            continue
        seen.add(c["name"].lower())
        unique_chains.append(c)
    print(f"chains: {len(unique_chains)} (steps: {[len(c['steps']) for c in unique_chains]})")
    if unknown:
        print(f"unknown slugs referenced by chains (skipped): {sorted(unknown)}")

    categories = {}
    for a in agents.values():
        categories.setdefault(a["category"], 0)
        categories[a["category"]] += 1
    print("categories:", json.dumps(categories, indent=2))

    library = {
        "version": "2026-06-06",
        "source": "ClaudeExtras agent suites + agent-chain-catalog (+suite5/suite8 patches)",
        "agents": [
            {k: v for k, v in a.items() if not k.startswith("_")}
            for a in sorted(agents.values(), key=lambda a: (a["category"], a["name"]))
        ],
        "chains": unique_chains,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(library, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
