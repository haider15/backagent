import { Agent, handoff, Trace, run } from '@openai/agents';
import levenshtein from 'fast-levenshtein';

// Modèle OpenAI utilisé
const mymodel = 'gpt-3.5-turbo';

// === Agent 3 : Validation SQL ===
export const validateAgent_ = Agent.create({
  name: 'validateAgent_',
  model: mymodel,
  instructions: `
Tu es un expert SQL qui valide la requête SQL fournie par l'agent précédent.
Si la requête est valide, répond **uniquement** par la requête SQL à exécuter.
Sinon, répond par :
SELECT 'Requête SQL non valide.' AS message;
`,
  hooks: {
    async beforeRun(ctx) {
      console.log("🔍 [validateAgent_] Entrée :", ctx.input);
    },
    async afterRun(ctx) {
      console.log("✅ [validateAgent_] Sortie :", ctx.output);
      ctx.trace = ctx.trace || new Trace({ name: 'validateAgent Trace', conversationId: ctx.conversationId });
    }
  }
});

// === Agent d'exécution SQL ===
export const executeAgent_ = Agent.create({
  name: 'executeAgent_',
  model: mymodel,
  instructions: `
Tu es un agent qui reçoit uniquement une requête SQL SELECT valide.
Tu dois exécuter cette requête SQL sur la base de données (via un hook).
Tu renvoies STRICTEMENT le JSON des résultats, sans aucun texte additionnel.
`,
  hooks: {
    async beforeRun(ctx) {
      const db = ctx.db;
      const sql = ctx.input.trim();

      console.log("🚀 [executeAgent_] Exécution SQL :", sql);

      if (!sql.toUpperCase().startsWith("SELECT")) {
        ctx.output = JSON.stringify([{ message: "Requête SQL non valide pour exécution." }]);
        return;
      }

      try {
        const [rows] = await db.execute(sql);
        ctx.output = JSON.stringify(rows);
      } catch (e) {
        ctx.output = JSON.stringify([{ message: `Erreur exécution SQL : ${e.message}` }]);
      }
    },
    async afterRun(ctx) {
      console.log("✅ [executeAgent_] Résultat JSON :", ctx.output);
      ctx.trace = ctx.trace || new Trace({ name: 'executeAgent Trace', conversationId: ctx.conversationId });
    }
  }
});

// === Agent 2 : Génération SQL ===
export const sqlAgent_ = Agent.create({
  name: 'sqlAgent_',
  model: mymodel,
  instructions: `
Tu es un expert SQL spécialisé en MySQL.
Ta tâche : générer UNIQUEMENT une requête SQL valide pour la base "lumiere_final1".
Ne jamais inclure de texte explicatif.

⚠️ Règle importante : 
Ne jamais utiliser une sous-requête avec '=' qui retourne plusieurs lignes. 
Utilise IN (...) ou une sous-requête corrélée.

Structure des tables :

- camion (
    matricule VARCHAR,
    code_site VARCHAR,
    capacite_palette INT,
    activite VARCHAR,
    etat ENUM('disponible', 'en panne'),
    performance_jour DECIMAL,
    nombre_voyages INT,
    date_voyage DATE,
    realisation_voyage VARCHAR
)

- chauffeur (
    matricule VARCHAR,
    nom VARCHAR,
    code_site VARCHAR,
    activite VARCHAR,
    performance_jour DECIMAL,
    nombre_voyages INT,
    date_voyage DATE,
    realisation_voyage VARCHAR
)

- conversations(id, theme, created_at)
- messages(id, conversation_id, role, content, created_at)
- traces(id, conversation_id, trace_json, created_at)

IMPORTANT :  
Après avoir généré la requête SQL, envoie-la à l'agent "validateAgent_" pour qu'il la valide.  
Ne donne aucune autre information, pas d'explications, uniquement la requête SQL.

Exemples :

1. "Afficher les chauffeurs disponibles"
   SELECT * FROM chauffeur
   WHERE (nombre_voyages = 0 OR realisation_voyage = '1/1')
   ORDER BY performance_jour ASC;

2. "Performance moyenne des chauffeurs par site sur 7 jours"
   SELECT code_site, AVG(performance_jour) AS perf_moyenne
   FROM chauffeur
   WHERE date_voyage >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
   GROUP BY code_site;

3. "Lister camions disponibles avec capacité > 50"
   SELECT matricule, capacite_palette
   FROM camion
   WHERE etat = 'disponible' AND capacite_palette > 50;

4. "Chauffeurs au-dessus de la moyenne de leur site"
   WITH perf_moy AS (
       SELECT code_site, AVG(performance_jour) AS moyenne_site
       FROM chauffeur
       GROUP BY code_site
   )
   SELECT ch.matricule, ch.nom, ch.performance_jour
   FROM chauffeur ch
   JOIN perf_moy pm ON ch.code_site = pm.code_site
   WHERE ch.performance_jour > pm.moyenne_site;

5. "Compter camions en panne par site"
   SELECT code_site, COUNT(*) AS nb_camions_en_panne
   FROM camion
   WHERE etat = 'en panne'
   GROUP BY code_site;

Si la question est trop complexe pour être traduite en SQL :
   SELECT 'Question trop complexe pour être traitée par cette base de données.' AS message;
`,
  handoffs: [handoff(validateAgent_)], // Transfert automatique vers validateAgent_ après génération
  hooks: {
    async beforeRun(ctx) {
      console.log("🛠️ [sqlAgent_] Entrée :", ctx.input);
    },
    async afterRun(ctx) {
      console.log("📤 [sqlAgent_] Sortie :", ctx.output);
    }
  }
});

// === Agent 1 : Détection de compatibilité ===
const keywords = [
  // Camion / véhicule
  "camion", "camions", "camionn", "camionns", "vehicule", "vehicules", "véhicule", "véhicules",

  // Chauffeur / conducteur
  "chauffeur", "chauffeurs", "chauffeurss", "conducteur", "conducteurs",

  // Colonnes communes
  "matricule", "code_site", "activite", "activité",
  "performance_jour", "nombre_voyages", "date_voyage", "realisation_voyage",
  "capacite_palette", "etat",

  // États / situations
  "disponible", "disponibles", "dispo", "en service",
  "en panne", "panne", "hors service",

  // Fonctions SQL usuelles
  "afficher", "donner", "lister", "montrer", "présenter", "recuperer", "obtenir", "voir",
  "trié", "classé", "ordonné", "ordre", "croissant", "décroissant", "ascendant", "descendant",
  "compter", "nombre", "total", "somme", "moyenne", "max", "min",
  "avec", "où", "dont", "ayant", "filtrer", "condition", "supérieur", "inférieur", "égal",
  "groupé", "par site", "par activité", "par code_site"
];

// --- Fonction utilitaire pour vérifier si la question est liée à la base ---
function isRelatedToDB(question) {
  const words = question.toLowerCase().split(/\s+/);
  return words.some(w =>
    keywords.some(k => levenshtein.get(w, k.toLowerCase()) <= 2) // Tolérance : 2 lettres
  );
}

// === Agent principal ===
export const agentMain_ = Agent.create({
  name: 'agentMain_',
  model: mymodel,
  instructions: `
Tu es l'agent principal qui décide si la question est compatible avec la base "lumiere_final1".

Tables :
- chauffeur : matricule, nom, code_site, activite, performance_jour, nombre_voyages, date_voyage, realisation_voyage
- camion : matricule, code_site, capacite_palette, activite, etat, performance_jour, nombre_voyages, date_voyage, realisation_voyage

Ta mission :
- Si la question parle de ces tables, colonnes ou concepts liés, elle est compatible.
- Tolère fautes de frappe, pluriels, synonymes.
- Les mots-clés / synonymes sont déjà analysés en amont (fuzzy match).

Si compatible => passer au sqlAgent_.
Sinon => renvoyer : SELECT 'Question non compatible avec la base de données.' AS message;
`,
  handoffs: [handoff(sqlAgent_)], // ⚠ sqlAgent_ doit être défini ailleurs
  hooks: {
    async beforeRun(ctx) {
      console.log("🏁 [agentMain_] Question :", ctx.input);

      if (!isRelatedToDB(ctx.input)) {
        console.log("❌ Question jugée non compatible");
        ctx.input = "SELECT 'Question non compatible avec la base de données.' AS message;";
      } else {
        console.log("✅ Question jugée compatible");
      }
    },
    async afterRun(ctx) {
      console.log("📤 [agentMain_] Sortie :", ctx.output);
    }
  }
});

// === Agent de visualisation ===
export const visualiserAgent_ = Agent.create({
  name: 'visualiserAgent_',
  model: mymodel,
  instructions: `
Tu es un agent de visualisation qui reçoit une requête SQL SELECT et ses résultats (format JSON).

Ta tâche : renvoyer STRICTEMENT un JSON valide décrivant une visualisation adaptée à ces données.

Le JSON doit contenir :
- type : "table", "bar", "pie", "line", ou autre type de graphique
- labels : liste des labels (ex: noms de catégories)
- datasets : liste d'objets avec "label" et "data" (tableau de valeurs numériques ou paires x/y)
- (optionnel) options : objet avec options du graphique

Exemple pour un graphique à barres :
{
  "type": "bar",
  "labels": ["Site A", "Site B", "Site C"],
  "datasets": [{
    "label": "Nombre camions en panne",
    "data": [5, 3, 7]
  }]
}

Exemple pour un graphique en secteurs (pie) :
{
  "type": "pie",
  "labels": ["Disponible", "En panne"],
  "datasets": [{
    "label": "Répartition des camions",
    "data": [12, 5]
  }]
}

Exemple pour un graphique en lignes (line) :
{
  "type": "line",
  "labels": ["2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04"],
  "datasets": [{
    "label": "Performance moyenne journalière des chauffeurs",
    "data": [78.5, 80.2, 82.1, 79.8]
  }]
}

Exemple pour un graphique en nuage de points (scatter) :
{
  "type": "scatter",
  "datasets": [{
    "label": "Performance vs Voyages",
    "data": [
      { "x": 5, "y": 80 },
      { "x": 8, "y": 85 },
      { "x": 3, "y": 70 }
    ]
  }]
}

Exemple pour un diagramme en radar :
{
  "type": "radar",
  "labels": ["Vitesse", "Sécurité", "Ponctualité", "Service client"],
  "datasets": [{
    "label": "Score chauffeur A",
    "data": [85, 90, 80, 75]
  }]
}

Exemple pour un diagramme à bulles (bubble) :
{
  "type": "bubble",
  "datasets": [{
    "label": "Volume de chargement",
    "data": [
      { "x": 5, "y": 80, "r": 10 },
      { "x": 8, "y": 85, "r": 15 },
      { "x": 3, "y": 70, "r": 8 }
    ]
  }]
}

Exemple pour un tableau :
{
  "type": "table",
  "columns": ["matricule", "code_site", "etat"],
  "rows": [
    ["M123", "Site A", "disponible"],
    ["M456", "Site B", "en panne"]
  ]
}
`
});



// --- Chaine des handoffs ---
agentMain_.handoffs = [handoff(sqlAgent_)];
sqlAgent_.handoffs = [handoff(validateAgent_)];
validateAgent_.handoffs = [handoff(executeAgent_)];
executeAgent_.handoffs = [handoff(visualiserAgent_)];

// === Fonctions utilitaires ===

function extractAgentOutput(agentResponse) {
  if (!agentResponse) return '(aucune réponse)';
  if (typeof agentResponse === 'string') return agentResponse;
  if (agentResponse.value && typeof agentResponse.value === 'string') return agentResponse.value;
  if (agentResponse.state && agentResponse.state._currentStep && typeof agentResponse.state._currentStep.output === 'string') {
    return agentResponse.state._currentStep.output;
  }
  try {
    return JSON.stringify(agentResponse).slice(0, 500);
  } catch {
    return '(impossible de parser la réponse)';
  }
}

function cleanSqlQuery(rawText) {
  return rawText
    .replace(/```sql\s*/gi, '')
    .replace(/```/gi, '')
    .trim();
}

function extractFinalSql(agentResponse) {
  const output = extractAgentOutput(agentResponse).trim();
  if (output.toUpperCase().startsWith('SELECT')) {
    return output;
  }
  return null;
}

async function executeSqlAndFormat(db, sql) {
  const [rows] = await db.execute(sql);
  return rows;
}

// === Fonction principale handleChat ===

export const handleChat = async (req, res) => {
  const db = req.db;
  const { message: userMessage, conversationId } = req.body;

  if (!userMessage || !conversationId) {
    return res.status(400).json({ error: 'Message et conversationId requis' });
  }

  try {
    const parentTrace = new Trace({ name: `Trace Conversation ${conversationId}`, conversationId });

    // Enregistrer la question utilisateur
    await db.execute('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [conversationId, 'user', userMessage]);

    console.log('--- Début Agent Main : analyse compatibilité ---');
    // Important: passer db dans contexte pour que executeAgent puisse exécuter la requête
    const mainAgentResponse = await run(agentMain_, [{ role: 'user', content: userMessage }], { trace: parentTrace, db });

    // Extraction SQL finale (du validateAgent_)
    const sqlGenerated = extractFinalSql(mainAgentResponse);

    if (!sqlGenerated) {
      const errMsg = "La requête SQL n'a pas pu être générée ou est invalide.";
      console.warn(errMsg);
      await db.execute('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [conversationId, 'assistant', errMsg]);
      return res.json({ reply: errMsg });
    }

    const cleanSql = cleanSqlQuery(sqlGenerated);
    console.log('--- Requête SQL finale validée par agents ---');
    console.log(cleanSql);

    // Exécuter la requête SQL
    const sqlResults = await executeSqlAndFormat(db, cleanSql);

    if (!sqlResults || sqlResults.length === 0) {
      const emptyMsg = "Aucun résultat trouvé pour cette requête.";
      await db.execute('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [conversationId, 'assistant', emptyMsg]);

      const traceData = parentTrace.toJSON();
      await db.execute('INSERT INTO traces (conversation_id, trace_json) VALUES (?, ?)', [conversationId, JSON.stringify(traceData)]);

      return res.json({
        reply: emptyMsg,
        visualizationType: "table",
        vizData: { type: "table", columns: [], rows: [] },
        rawResults: [],
        trace: traceData,
      });
    }

    // Préparer l'entrée pour l'agent de visualisation (SQL + résultats JSON)
    const visualisationInput = JSON.stringify({
      sql: cleanSql,
      results: sqlResults
    });

    // Obtenir la visualisation JSON
    const visualisationResponse = await run(visualiserAgent_, [{ role: 'user', content: visualisationInput }], { trace: parentTrace });

    const visualisationJsonText = extractAgentOutput(visualisationResponse);

    let visualizationData;
    try {
      visualizationData = JSON.parse(visualisationJsonText);
      console.log('📊 Visualisation JSON analysée :', visualizationData);

      // === AJOUT : Sauvegarder la visualisation en base ===
      try {
        await db.execute(
          'INSERT INTO visualisations (conversation_id, viz_json) VALUES (?, ?)',
          [conversationId, JSON.stringify(visualizationData)]
        );
        console.log("✅ Visualisation sauvegardée en base.");
      } catch (e) {
        console.warn("⚠️ Erreur sauvegarde visualisation :", e.message);
      }

    } catch (err) {
      console.warn('Erreur parsing visualisation JSON:', err);
      console.warn('Contenu reçu:', visualisationJsonText);
      visualizationData = { 
        type: 'table', 
        columns: Object.keys(sqlResults[0] || {}), 
        rows: sqlResults.map(r => Object.values(r)) 
      };
    }

    // Construire la réponse assistant
    const assistantMessage = `Voici la visualisation des données.`;

    // Enregistrer la réponse assistant
    await db.execute('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)', [conversationId, 'assistant', assistantMessage]);

    // Sauvegarder la trace
    const traceData = parentTrace.toJSON();
    await db.execute('INSERT INTO traces (conversation_id, trace_json) VALUES (?, ?)', [conversationId, JSON.stringify(traceData)]);

    // Renvoi au frontend
    return res.json({
      reply: assistantMessage,
      visualizationType: visualizationData.type,
      vizData: visualizationData,
      rawResults: sqlResults,
      trace: traceData,
      sql: cleanSql, // Optionnel, pour debug frontend
    });

  } catch (error) {
    console.error('Erreur serveur inattendue:', error);
    return res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
};

// === Fonctions pour gérer les conversations ===

export const createConversation = async (req, res) => {
  const db = req.db;
  const { theme } = req.body;

  if (!theme) return res.status(400).json({ error: 'Thème requis' });

  try {
    const [result] = await db.execute('INSERT INTO conversations (theme) VALUES (?)', [theme]);
    res.status(201).json({ conversationId: result.insertId, message: 'Conversation créée' });
  } catch (error) {
    console.error('Erreur création conversation :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const getHistory = async (req, res) => {
  const db = req.db;
  const { conversationId } = req.params;

  if (!conversationId) return res.status(400).json({ error: 'conversationId requis' });

  try {
    const [rows] = await db.execute(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC',
      [conversationId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Erreur getHistory :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const getConversations = async (req, res) => {
  const db = req.db;

  try {
    const [rows] = await db.execute('SELECT id, theme FROM conversations ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    console.error('Erreur getConversations :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

export const deleteConversation = async (req, res) => {
  const db = req.db;
  const { id } = req.params;

  if (!id) return res.status(400).json({ error: 'ID conversation requis' });

  try {
    await db.execute('DELETE FROM messages WHERE conversation_id = ?', [id]);
    await db.execute('DELETE FROM traces WHERE conversation_id = ?', [id]);
    await db.execute('DELETE FROM conversations WHERE id = ?', [id]);
    res.json({ message: 'Conversation supprimée' });
  } catch (error) {
    console.error('Erreur suppression conversation :', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};
//////
// Ajouter une visualisation pour une conversation donnée
export const addVisualisation = async (req, res) => {
  const db = req.db;
  const { conversationId, vizJson } = req.body;

  if (!conversationId || !vizJson) {
    return res.status(400).json({ error: "conversationId et vizJson requis" });
  }

  try {
    await db.execute(
      'INSERT INTO visualisations (conversation_id, viz_json) VALUES (?, ?)',
      [conversationId, JSON.stringify(vizJson)]
    );
    res.status(201).json({ message: "Visualisation ajoutée" });
  } catch (error) {
    console.error("Erreur addVisualisation:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// Récupérer toutes les visualisations d'une conversation
export const getVisualisations = async (req, res) => {
  const db = req.db;
  const { conversationId } = req.params;

  if (!conversationId) return res.status(400).json({ error: "conversationId requis" });

  try {
    const [rows] = await db.execute(
      'SELECT id, viz_json, created_at FROM visualisations WHERE conversation_id = ? ORDER BY created_at DESC',
      [conversationId]
    );
    // parser JSON pour chaque ligne
    const visualisations = rows.map(row => ({
      id: row.id,
      vizJson: JSON.parse(row.viz_json),
      createdAt: row.created_at,
    }));
    res.json(visualisations);
  } catch (error) {
    console.error("Erreur getVisualisations:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// Supprimer une visualisation par ID
export const deleteVisualisation = async (req, res) => {
  const db = req.db;
  const { id } = req.params;

  if (!id) return res.status(400).json({ error: "ID visualisation requis" });

  try {
    await db.execute('DELETE FROM visualisations WHERE id = ?', [id]);
    res.json({ message: "Visualisation supprimée" });
  } catch (error) {
    console.error("Erreur deleteVisualisation:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

