import json
from agents import Agent
from agents.extensions.visualization import draw_graph

def build_agent_tree(data):
    """Construit récursivement un Agent avec ses handoffs sous forme d’objets Agent."""
    handoffs = [build_agent_tree(h) for h in data.get("handoffs", [])]
    return Agent(
        name=data.get("name", "Agent"),
        instructions=data.get("instructions", ""),
        tools=data.get("tools", []),
        handoffs=handoffs,
    )

def main():
    try:
        with open("agent_structure.json", "r", encoding="utf-8") as f:
            data = json.load(f)

        agent = build_agent_tree(data)

        draw_graph(agent, filename="agent_graph")  # génère agent_graph.png
        print("✅ Graph généré avec succès : agent_graph.png")
    except Exception as e:
        print(f"❌ Erreur lors de la génération du graph : {e}")

if __name__ == "__main__":
    main()
