// server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import mysql from 'mysql2/promise';
import OpenAI from 'openai';
import chatRoutes from './routes/chatRoutes.js';

dotenv.config();
const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

async function main() {
  try {
    if (!process.env.OPENAI_API_KEY || !process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
      throw new Error('❌ .env mal configuré.');
    }

    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
    });
    console.log('✅ MySQL connecté');

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('✅ OpenAI initialisé');

    app.use((req, res, next) => {
      req.db = db;
      req.openai = client;
      next();
    });

    // Route unique
    app.use('/', chatRoutes);

    app.listen(port, () => {
      console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
    });
  } catch (err) {
    console.error('❌ Erreur de démarrage :', err.message);
  }
}

main();
