# Plan de Test Complet - Application Anu

## Objectif
Vérifier que toutes les fonctionnalités implémentées fonctionnent correctement.

## URL de test
https://6dfh3pqhdb2v.space.minimax.io

## Scénarios de Test

### Test 1: Inscription Nouvel Utilisateur
- Créer compte avec pseudo: alice_test2025
- Vérifier redirection vers /chats
- Statut attendu: ✅ SUCCÈS

### Test 2: Ajout de Contact
- Depuis page Contacts
- Cliquer bouton "+" pour ajouter contact
- Rechercher utilisateur: eve2025 (créé précédemment)
- Statut attendu: ✅ SUCCÈS

### Test 3: Création Conversation
- Depuis liste contacts
- Cliquer icône message pour eve2025
- Vérifier création conversation
- Vérifier redirection /chat/[id]
- Statut attendu: ✅ SUCCÈS

### Test 4: Envoi Message Texte
- Dans conversation avec eve2025
- Envoyer message: "Bonjour de alice_test2025"
- Vérifier affichage message
- Statut attendu: ✅ SUCCÈS

### Test 5: Navigation Globale
- Tester bottom nav: Chats → Statuts → Contacts → Paramètres
- Vérifier chaque page charge correctement
- Statut attendu: ✅ SUCCÈS

### Test 6: Création Groupe
- Page Chats → Bouton groupe
- Nom: "Groupe Test"
- Sélectionner eve2025 comme membre
- Créer groupe
- Statut attendu: ✅ SUCCÈS

### Test 7: Publication Statut
- Page Statuts → Ajouter statut
- Upload image (si possible)
- Texte: "Mon premier statut"
- Publier
- Statut attendu: ✅ SUCCÈS (ou ⚠️ si upload échoue)

### Test 8: Déconnexion
- Page Paramètres → Se déconnecter
- Vérifier redirection /auth
- Statut attendu: ✅ SUCCÈS

### Test 9: Reconnexion
- Page Auth → Mode connexion
- Pseudo: alice_test2025
- Mot de passe: [celui utilisé]
- Vérifier redirection /chats
- Statut attendu: ✅ SUCCÈS

### Test 10: Vérification Persistance
- Vérifier conversations créées présentes
- Vérifier messages envoyés affichés
- Statut attendu: ✅ SUCCÈS
