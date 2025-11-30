// Script final pour appliquer les migrations via Supabase Management API
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_REF = 'imkfbalgviqeotpjogff';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlta2ZiYWxndmlxZW90cGpvZ2ZmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQ2MTY2NiwiZXhwIjoyMDgwMDM3NjY2fQ.RCt9jE__ViZ5BCO9do967mp3NgsaGpm4s7cV3_nuH9c';

const migrations = [
  { file: '../supabase/migrations/1764470000_create_message_reactions_table.sql', name: 'Réactions' },
  { file: '../supabase/migrations/1764470100_add_reply_to_messages.sql', name: 'Réponses' },
  { file: '../supabase/migrations/1764470200_add_ephemeral_messages.sql', name: 'Éphémères' },
  { file: '../supabase/migrations/1764470300_create_media_bucket.sql', name: 'Médias' },
  { file: '../supabase/migrations/1764470400_add_advanced_features.sql', name: 'Avancées' },
];

async function executeSqlDirect(sql) {
  // Utiliser l'endpoint de la database directement
  const url = `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/exec`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ sql }),
  });

  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function applyMigrations() {
  console.log('🚀 Application des nouvelles migrations Supabase...\n');
  console.log(`📍 Projet: ${PROJECT_REF}\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const migration of migrations) {
    const fullPath = path.join(__dirname, migration.file);
    
    console.log(`📝 ${migration.name}: ${path.basename(migration.file)}`);
    
    try {
      if (!fs.existsSync(fullPath)) {
        console.log(`   ⚠️  Fichier non trouvé: ${fullPath}\n`);
        errorCount++;
        continue;
      }

      const sql = fs.readFileSync(fullPath, 'utf8');
      
      // Afficher un aperçu
      const lines = sql.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
      console.log(`   📄 ${lines.length} lignes SQL à exécuter`);
      
      // Pour l'instant, on affiche juste le SQL
      // L'API Supabase ne permet pas d'exécuter du SQL arbitraire pour des raisons de sécurité
      console.log(`   ✅ Migration prête (à appliquer manuellement)\n`);
      successCount++;
      
    } catch (err) {
      console.error(`   ❌ Erreur: ${err.message}\n`);
      errorCount++;
    }
  }

  console.log('═'.repeat(60));
  console.log(`\n📊 Résumé:`);
  console.log(`   ✅ Migrations prêtes: ${successCount}`);
  console.log(`   ❌ Erreurs: ${errorCount}`);
  console.log(`\n🎯 Action Requise:`);
  console.log(`   Les migrations doivent être appliquées manuellement car`);
  console.log(`   Supabase ne permet pas d'exécuter du SQL via l'API REST.`);
  console.log(`\n📋 Instructions:`);
  console.log(`   1. Ouvrez: https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`);
  console.log(`   2. Copiez-collez le contenu de chaque fichier SQL`);
  console.log(`   3. Cliquez sur "Run" pour chaque migration`);
  console.log(`\n💡 Astuce: Ouvrez les fichiers dans VSCode et copiez-les un par un`);
  console.log(`\n🎉 Une fois fait, toutes les fonctionnalités seront actives!`);
}

applyMigrations().catch(console.error);