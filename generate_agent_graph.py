# generate_agent_graph.py
import json
from agents import Agent
from agents.extensions.visualization import draw_graph

def build_agent_tree(data):
    """Construit récursivement un Agent avec ses handoffs."""
    handoffs = [build_agent_tree(h) for h in data.get("handoffs", [])]
    return Agent(
        name=data["name"],
        instructions=data["instructions"],
        tools=data.get("tools", []),
        handoffs=handoffs
    )

if __name__ == "__main__":
    with open("agent_structure.json", "r", encoding="utf-8") as f:
        data = json.load(f)

    root_agent = build_agent_tree(data)
    draw_graph(root_agent, filename="agent_graph")
    print("✅ Graph généré avec succès")
