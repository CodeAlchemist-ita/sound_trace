# Sicurezza: stato attuale e modifiche da fare

Valutazione del 9 novembre 2026, dopo l'introduzione di sincronizzazione lato server, amici e playlist.

## Come funziona oggi

- **Database (Supabase):** tutte le tabelle hanno RLS attivo senza regole e i permessi di `anon`/`authenticated` sono revocati. Leggono e scrivono solo le Edge Functions con la chiave di servizio, che non è mai nell'app.
- **Identità:** le funzioni `sync`, `friends`, `register` e `token` (consegna) chiedono a Spotify a chi appartiene il token ricevuto (`/me`) prima di fare qualsiasi cosa.
- **Sincronizzazione sul server:** il dispositivo consegna il refresh token Spotify alla funzione `token` e conserva solo una **chiave dispositivo** casuale da 256 bit. Sul server, in `device_keys`, se ne salva solo lo SHA-256. Il refresh token resta solo sul server (`spotify_tokens`).
- **Cron:** `pg_cron` chiama la funzione `token` ogni 15 minuti con un segreto salvato nel Vault e nei segreti della funzione (`CRON_SECRET`). Il confronto avviene a tempo costante, e senza segreto la risposta è 403.
- **Amici:** profilo, ascolti e playlist di un utente sono visibili solo con un'amicizia accettata. Rimuovendo l'amico l'accesso finisce subito. Gli id passati alle funzioni vengono validati prima di finire nei filtri PostgREST.
- **Permessi Spotify:** solo lettura (`user-read-recently-played`, `user-read-currently-playing`, `user-read-private`, `user-read-email`, `playlist-read-private`, `playlist-read-collaborative`). Con un token rubato non si può riprodurre, modificare playlist o cambiare l'account.
- **In riproduzione ora:** gli amici accettati vedono il brano che stai ascoltando in questo momento (funzione `friends`, azione `now`). Il server lo chiede a Spotify al massimo ogni 20 secondi per utente e non lo salva. Vale solo per chi ha concesso il permesso `user-read-currently-playing` accedendo di nuovo.
- **Testi e traduzioni:** il testo del brano in riproduzione lo scarica direttamente il dispositivo da LRCLIB, a cui invia solo titolo, artista, album e durata. La traduzione parte solo quando premi «Traduci in italiano»: la funzione `translate` controlla il token Spotify, inoltra il testo a DeepL e restituisce la traduzione senza salvare né registrare nulla (testo e risposte non finiscono nei log, nessun database). Sul dispositivo testo e traduzione restano solo in memoria e spariscono al cambio brano o alla chiusura dell'app: niente su SQLite, file o archivio sicuro.
- **Scelte di privacy:** ogni utente decide in *Impostazioni → Cosa vedono gli amici* se mostrare brano in riproduzione, ascolti recenti, statistiche e classifiche, playlist. Le scelte stanno nella tabella `privacy_settings` e le applica la funzione `friends` prima di rispondere, quindi valgono anche per chi usa una versione vecchia o modificata dell'app. Senza una riga salvata è tutto visibile, come prima. Se la tabella non si può leggere la funzione risponde con un errore invece di mostrare tutto.
- **Consigli di brani:** solo un amico accettato può consigliarti un brano (funzione `friends`, azione `recommend`), al massimo 20 consigli ogni 24 ore per chi li invia, con un messaggio facoltativo di 280 caratteri al massimo. Un utente può spegnere la ricezione con l'interruttore *Ricevere consigli* (quinta scelta di privacy, applicata dal server). Lo stesso brano non può essere consigliato due volte allo stesso amico. Quando l'amico ascolta quel brano dopo il consiglio, chi lo ha inviato vede «ascoltato ✓»: questo rivela a chi consiglia che l'amico ha ascoltato proprio quel brano, e niente altro. Rimuovere un amico non cancella i consigli già scambiati; ognuno dei due può eliminarli.
- **Registro errori:** resta sul dispositivo (`src/lib/errorLog.ts`), con token ed email oscurati. Esce solo se l'utente lo condivide da Impostazioni.
- **Rete:** tutte le chiamate hanno un timeout (`src/lib/http.ts`).

## Punti deboli

| # | Rischio | Gravità | Soluzione proposta |
|---|---|---|---|
| 1 | APK firmato con la chiave di debug pubblica di React Native (`android/app/debug.keystore`). Chiunque può firmare un APK falso che Android accetta come aggiornamento dell'app, e che leggerebbe i dati salvati, inclusa la chiave dispositivo. Serve però convincere qualcuno a installarlo. | Media | Creare una chiave di firma propria. Va fatto una volta sola, e ogni utente deve disinstallare e reinstallare. Gli ascolti tornano dal cloud dopo il login. |
| 2 | Refresh token Spotify salvati in chiaro in `spotify_tokens`. Chi entra nell'account Supabase, o ottiene la chiave di servizio, può leggere ascolti e playlist private di tutti, finché gli utenti non revocano l'accesso da Spotify. | Media | Cifrarli (AES-GCM) con una chiave presente solo nei segreti delle funzioni (`TOKEN_ENCRYPTION_KEY`). Il database da solo non basta più. |
| 3 | La chiave dispositivo non scade mai. Se il telefono viene perso resta valida, e non esiste "disconnetti tutti i dispositivi". | Bassa-media | Pulsante "Disconnetti tutti i dispositivi" in Impostazioni, e scadenza automatica delle chiavi non usate da 60 giorni (pulizia dal cron). |
| 4 | Sul PC la chiave dispositivo è nel `localStorage` del browser. Prima ci stava il refresh token, quindi il rischio non è peggiorato. | Bassa | Accettabile per uso personale. |
| 5 | La richiesta d'amicizia rivela se un'email è registrata, e non c'è limite al numero di richieste. | Bassa | Limite di richieste per utente all'ora, oppure messaggio generico. |

## Modifiche da fare (in ordine)

### 1. Chiave di firma propria per l'APK
- Generare un keystore personale (`keytool -genkeypair …`), conservato **fuori dal repository** con un backup sicuro. Se si perde, l'app non si può più aggiornare.
- Configurarlo con un config plugin in `app.json` o con le credenziali EAS, non modificando `android/` a mano.
- Farlo **subito**, finché gli utenti sono pochi: ognuno deve disinstallare e reinstallare una volta.

### 2. Cifratura dei refresh token
- Nuovo segreto `TOKEN_ENCRYPTION_KEY` (32 byte casuali) nei segreti delle funzioni.
- `_shared/spotifyServer.ts`: cifrare in scrittura e decifrare in lettura (Web Crypto, AES-GCM con IV casuale per ogni token).
- Migrare i token esistenti alla prima lettura: se il valore non è cifrato, cifrarlo e salvarlo.
- Nessun intervento richiesto agli utenti.

### 3. Gestione dei dispositivi
- Funzione `token`: nuova azione `revokeAll`, che cancella tutte le chiavi dell'utente e ferma la sincronizzazione sul server.
- Impostazioni: pulsante "Disconnetti tutti i dispositivi", che chiede conferma.
- Cron: cancellare le chiavi con `last_used_at` più vecchio di 60 giorni.

### 4. (Facoltativo) Limite alle richieste d'amicizia
- Al massimo N richieste per utente all'ora nella funzione `friends`.
