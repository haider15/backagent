// controllers/generateGraph.js
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Résolution de __dirname pour ESModules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const generateAgentGraph = (req, res) => {
  // Choix de la commande python selon la plateforme
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  // Chemin absolu vers le script Python
  const scriptPath = path.resolve(__dirname, '../agent_graph.py');

  exec(`${pythonCmd} "${scriptPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Erreur génération graph :', error);
      console.error('Stdout:', stdout);
      console.error('Stderr:', stderr);
      return res.status(500).json({ error: 'Erreur lors de la génération du graphe.' });
    }

    // Chemin absolu vers l'image générée (supposée à la racine du projet)
    const imagePath = path.resolve(__dirname, '../agent_graph.png');

    // Vérification existence fichier image
    if (!fs.existsSync(imagePath)) {
      return res.status(500).json({ error: 'Fichier image non généré.' });
    }

    // Envoi du fichier image
    res.sendFile(imagePath, (err) => {
      if (err) {
        console.error('❌ Erreur envoi fichier image :', err);
        res.status(500).end();
      }
    });
  });
};
