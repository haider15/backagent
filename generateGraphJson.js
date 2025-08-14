// generateGraphJson.js
import { writeFileSync } from 'fs';

const mainAgentStructure = {
  name: "MainAgent",
  instructions: "Agent principal orchestrant toute la chaîne.",
  tools: [],
  handoffs: [
    {
      name: "ParseQuestionAgent",
      instructions: "Analyse la question en langage naturel et identifie tables + colonnes pertinentes.",
      tools: [],
      handoffs: [
        {
          name: "GetUniqueNounsAgent",
          instructions: "Extrait les noms/valeurs textuelles exactes des colonnes identifiées.",
          tools: [],
          handoffs: [
            {
              name: "GenerateSqlAgent",
              instructions: "Génère la requête SQL brute basée sur le contexte.",
              tools: [],
              handoffs: [
                {
                  name: "ValidateSqlAgent",
                  instructions: "Vérifie la syntaxe SQL et corrige si besoin.",
                  tools: [],
                  handoffs: [
                    {
                      name: "ChooseVisualizationAgent",
                      instructions: "Choisit le type de visualisation des résultats.",
                      tools: [],
                      handoffs: []
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};

writeFileSync('main_agent_structure.json', JSON.stringify(mainAgentStructure, null, 2), 'utf-8');

console.log("✅ Fichier main_agent_structure.json généré.");
