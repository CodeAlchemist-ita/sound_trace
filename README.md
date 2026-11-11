# Spotify Stats

App per telefono (Android/iOS) e PC (browser), fatta con Expo / React Native, che si collega al tuo account Spotify e mostra le tue statistiche di ascolto: minuti, classifiche, calendario, riepilogo dell'anno, amici e molto altro. I dati restano in un database SQLite sul tuo dispositivo; una parte online **facoltativa** su Supabase aggiunge sincronizzazione telefono/PC, amici e sincronizzazione sul server.

> Questo repository è pensato per essere clonato e usato **con la tua istanza**: ti servono la tua app Spotify (gratuita) e, se vuoi le funzioni online, il tuo progetto Supabase (piano gratuito sufficiente). Nessuna chiave o identificatore personale è incluso nel codice.

## Indice

1. [Funzionalità](#1-funzionalità)
2. [Architettura](#2-architettura)
3. [Prerequisiti](#3-prerequisiti)
4. [Configurazione Spotify](#4-configurazione-spotify)
5. [Configurazione locale](#5-configurazione-locale)
6. [Supabase passo per passo](#6-supabase-passo-per-passo)
7. [Avvio](#7-avvio)
8. [Build APK (e iOS)](#8-build-apk-e-ios)
9. [Firma dell'app](#9-firma-dellapp)
10. [Test e qualità](#10-test-e-qualità)
11. [Risoluzione problemi](#11-risoluzione-problemi)
12. [Privacy e sicurezza](#12-privacy-e-sicurezza)
13. [Note legali](#13-note-legali)
14. [Contribuire](#14-contribuire)
15. [Licenza](#15-licenza)

---

## 1. Funzionalità

- **Minuti ascoltati dal 1° gennaio a oggi** (più ore totali, numero di ascolti, brani diversi, media al giorno) e **obiettivo annuale** con proiezione di fine anno al ritmo attuale.
- **Recenti**: tutti gli ascolti salvati, dal più recente, raggruppati per giorno, con ora, durata ascoltata e brani saltati segnati.
- **Canzoni / Artisti / Album**: classifica per periodo (7 giorni, 30 giorni, quest'anno, sempre, oppure un anno passato), ordinabile per ascolti o minuti, con ricerca per titolo, artista o album.
- **Dettaglio di brano, album e artista**: ascolti e tempo totali, primo e ultimo ascolto, andamento degli ultimi 12 mesi, brani più ascoltati dell'artista e cronologia completa.
- **Statistiche** per periodo: minuti, ascolti, brani e artisti diversi e scoperti, giorni con musica, giorni della settimana, ore del giorno, artisti top, giorno record, giorni di fila, percentuale di brani saltati (solo con la cronologia importata), confronto con il periodo precedente, calendario a colori dell'anno, brani in salita e in discesa, sessioni di ascolto, generi, varietà (fedele/esploratore), brani da riscoprire.
- **Importazione della cronologia Spotify** (file `.json` della «Cronologia streaming estesa» o dei dati dell'account): per avere anche gli anni passati, con minuti reali.
- **Riepilogo dell'anno a storie**: minuti totali, prima canzone dell'anno, artista e canzone top con le loro top 5, mese più musicale, momento della giornata preferito, giorni di fila, schermata finale da salvare con uno screenshot.
- **In riproduzione ora**: in Home il brano che stai ascoltando, con barra di avanzamento; nella scheda Amici e nel profilo di un amico, quello che sta ascoltando lui.
- **Testo del brano e traduzione**: dalla scheda «In riproduzione ora» il pulsante «Testo» mostra il testo (da [LRCLIB](https://lrclib.net), scaricato direttamente dal dispositivo). «Traduci in italiano» traduce con DeepL, solo su richiesta, tramite la funzione `translate`. Testo e traduzione non vengono mai salvati.
- **Amici**: richieste d'amicizia via email, profilo e statistiche degli amici, playlist degli amici, in riproduzione ora degli amici.
- **Consigliare un brano a un amico** con messaggio facoltativo; chi lo riceve lo trova nella scheda Amici, chi lo invia vede «ascoltato ✓» quando l'amico lo ascolta.
- **Privacy verso gli amici**: in Impostazioni scegli cosa far vedere (brano in riproduzione, ascolti recenti, statistiche e classifiche, playlist) e se ricevere consigli. Le scelte le applica il server.
- **Playlist**: le tue playlist (anche collaborative) e quelle degli amici.
- **Sincronizzazione telefono ↔ PC** facoltativa tramite Supabase.
- **Sincronizzazione sul server** facoltativa: ogni 15 minuti il server salva gli ultimi ascolti di tutti gli utenti, anche con il telefono spento.
- **Tema chiaro e scuro, italiano e inglese**, durata minima di un ascolto (10, 30 o 60 secondi), primo giorno della settimana, vibrazione al tocco.
- **Registro errori locale** (token ed email oscurati, nulla viene inviato).

Ogni dispositivo ha il suo database SQLite locale, quindi l'app funziona anche offline. Sul telefono i token Spotify sono in SecureStore, sul PC nel `localStorage` del browser.

### Come funzionano i dati (importante)

L'API di Spotify fa leggere alle app **solo gli ultimi 50 brani ascoltati**: non esiste un endpoint con la cronologia dell'anno. Per questo l'app usa due fonti:

1. **Sincronizzazione automatica**: a ogni apertura (e in background sul telefono, o dal server se lo configuri) legge gli ultimi 50 brani e li accumula nel database. Copre gli ascolti da quando hai fatto l'accesso in poi.
2. **Importazione della cronologia Spotify**: per gli ascolti precedenti richiedi i tuoi dati su spotify.com → Account → Privacy (la «Cronologia streaming estesa» è la più precisa) e importa i file `.json` da *Impostazioni → Importa file della cronologia*. Sono supportati sia `Streaming_History_Audio_*.json` sia `StreamingHistory_music_*.json`.

Regole di calcolo:
- un **ascolto** conta solo se dura almeno 30 secondi (come fa Spotify). La soglia si può cambiare in Impostazioni (10, 30 o 60 secondi) e vale per la cronologia importata; le statistiche degli amici, calcolate sul server, usano sempre 30 secondi;
- per i dati importati i minuti sono quelli **reali**; per quelli sincronizzati via API Spotify non dice per quanto hai ascoltato, quindi si conta **la durata intera del brano** (stima);
- quando importi la cronologia, le stime API dello stesso periodo vengono sostituite dai dati reali;
- podcast e audiolibri sono esclusi.

Nessun dato viene cancellato al cambio d'anno: ogni ascolto è salvato con data e ora.

## 2. Architettura

```
 ┌───────────────────────────┐        ┌────────────────────────────┐
 │ App Expo (Android/iOS/web)│        │ Spotify Web API / Accounts │
 │  - SQLite locale          │◄──────►│  (login PKCE, recently     │
 │  - token in SecureStore   │        │   played, now playing, …)  │
 └────────────┬──────────────┘        └──────────────▲─────────────┘
              │ HTTPS (facoltativo)                  │
              ▼                                      │
 ┌──────────────────────────────────────────────────┴─────────────┐
 │ Supabase                                                       │
 │  Edge Functions: sync · token · friends · register · translate │
 │  Postgres (RLS attivo, solo la chiave di servizio delle        │
 │  funzioni legge/scrive) + pg_cron + pg_net + Vault             │
 └───────────────┬────────────────────────────────────────────────┘
                 │ solo "translate", solo su richiesta
                 ▼
            DeepL API Free

 Il testo dei brani viene scaricato direttamente dal dispositivo da LRCLIB.
```

Cosa è facoltativo:

| Parte | Serve per | Senza |
|---|---|---|
| **Client ID Spotify** | tutto: è l'unica cosa obbligatoria | l'app non permette il login |
| **Supabase** (`sync`, `register`) | sync telefono/PC | l'app funziona solo in locale, ogni dispositivo ha i suoi dati |
| `friends` | amici, consigli, privacy, playlist degli amici | scheda Amici non disponibile |
| `token` + pg_cron | sync sul server con l'app chiusa | sync in background del telefono / ogni 10 minuti sul PC |
| `translate` + DeepL | traduzione dei testi | il testo si vede, la traduzione no («Traduzione non configurata») |

Funzioni (`supabase/functions/`):

- `sync`: scambia gli ascolti tra i dispositivi di uno stesso utente.
- `register`: registra l'email dell'utente e collega l'account Spotify con la stessa email.
- `friends`: amicizie, profili, playlist, in riproduzione ora, privacy, consigli.
- `token`: tiene i refresh token Spotify sul server e fa il giro di sincronizzazione ogni 15 minuti (azione `poll`, chiamata da pg_cron).
- `translate`: inoltra il testo a DeepL su richiesta e lo restituisce, senza salvarlo.

## 3. Prerequisiti

- **Node.js** LTS (Node 22 o più recente: i test usano `node:sqlite`), **npm** e **git**.
- Un account **Spotify** e accesso a <https://developer.spotify.com/dashboard>.
- Per le funzioni online: un account **Supabase** gratuito. La CLI di Supabase si usa con `npx supabase …`, non serve installarla.
- Per compilare l'APK in locale: **Android Studio** (SDK e JDK incluso) o un JDK compatibile.
- Facoltativi: un account **Expo/EAS** (build nel cloud), un account **DeepL API Free** (traduzione dei testi), un Mac per iOS.

## 4. Configurazione Spotify

1. Vai su <https://developer.spotify.com/dashboard> e accedi.
2. **Create app**: scegli un nome e una descrizione qualsiasi. In *Which API/SDKs are you planning to use?* seleziona **Web API**.
3. In *Redirect URIs* aggiungi i valori che ti servono (devono coincidere **esattamente**, carattere per carattere):

   | Dove usi l'app | Redirect URI |
   |---|---|
   | Telefono: development build e APK (schema dell'app, `app.json` → `scheme`) | `spotifystats://callback` |
   | PC / browser (`npm run pc` o `npm run web`) | `http://127.0.0.1:8081/callback` |

   Il valore è costruito in `src/lib/auth.tsx` con `makeRedirectUri({ scheme: 'spotifystats', path: 'callback' })`: sul telefono è `spotifystats://callback`, sul web è l'indirizzo della pagina `/callback` (rotta `src/app/callback.tsx`). Spotify non accetta `localhost`: sul PC apri sempre `http://127.0.0.1:8081`. Se pubblichi la versione web su un altro dominio, aggiungi anche `https://tuo-dominio/callback` (e imposta le intestazioni descritte in [Avvio](#7-avvio)).

   Se non sei sicuro del valore, avvia l'app senza `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`: la schermata di accesso mostra il Redirect URI da aggiungere.
4. **Permessi (scope)**: non vanno configurati sul dashboard, li chiede l'app (`src/lib/spotify.ts`, `SPOTIFY_SCOPES`). Sono tutti di sola lettura:
   - `user-read-recently-played`: gli ultimi 50 brani ascoltati;
   - `user-read-currently-playing`: «In riproduzione ora» (`src/lib/nowPlaying.ts`);
   - `user-read-private`: profilo (paese, nome);
   - `user-read-email`: verifica che l'email dell'account coincida con quella registrata;
   - `playlist-read-private`, `playlist-read-collaborative`: le tue playlist.
5. **Development mode e User Management**: una nuova app Spotify parte in *Development mode* e funziona solo per un massimo di **25 utenti**, che devi aggiungere a mano in *Settings → User Management* (nome ed **email dell'account Spotify**). Aggiungi la tua email e quelle degli amici che vogliono usare la tua istanza. Spotify non ha un'API per farlo: l'elenco di chi si è registrato nell'app è nella tabella `registrations` di Supabase. Per superare il limite serve richiedere una *extended quota* a Spotify (non è compresa in questo progetto).
6. **Client Secret**: non serve e non va messo da nessuna parte. Il login usa il flusso Authorization Code con **PKCE**. Copia solo il **Client ID** (è pubblico).

## 5. Configurazione locale

```bash
git clone <url-del-tuo-repository> spotify-stats
cd spotify-stats
npm install
cp .env.example .env.local        # su Windows PowerShell: Copy-Item .env.example .env.local
```

Apri `.env.local` e compila le variabili (tutte `EXPO_PUBLIC_*`, quindi **inserite nell'app al momento della build**: dopo averle cambiate riavvia Metro con `npx expo start -c` o ricompila):

| Variabile | Obbligatoria | Significato |
|---|---|---|
| `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` | sì | Client ID dell'app Spotify |
| `EXPO_PUBLIC_SYNC_URL` | no | `https://<project-ref>.supabase.co/functions/v1/sync`. Abilita le funzioni online |
| `EXPO_PUBLIC_TOKEN_URL` | no | funzione `token`; se vuota si ricava da `EXPO_PUBLIC_SYNC_URL` (`/sync` → `/token`) |
| `EXPO_PUBLIC_FRIENDS_URL` | no | funzione `friends`; se vuota si ricava da `EXPO_PUBLIC_SYNC_URL` |
| `EXPO_PUBLIC_REGISTER_URL` | no | funzione `register`; se vuota si ricava da `EXPO_PUBLIC_SYNC_URL` |
| `EXPO_PUBLIC_TRANSLATE_URL` | no | funzione `translate`; se vuota si ricava da `EXPO_PUBLIC_SYNC_URL` |

Le quattro variabili facoltative servono solo se le funzioni stanno in indirizzi diversi da quello di `sync`. Con il solo Client ID l'app funziona già in locale.

`.env.local` è ignorato da git: non committarlo mai.

## 6. Supabase passo per passo

Tutto questo è facoltativo: serve per sincronizzazione telefono/PC, amici, sync sul server e traduzione.

**Sicurezza in breve:** l'app non usa account Supabase e non contiene nessuna chiave Supabase. Manda alle funzioni il token Spotify che ha già; la funzione chiede a Spotify a quale utente appartiene (`/me`) e legge o scrive solo le righe di quell'utente con la chiave di servizio, che resta sul server. Le tabelle hanno RLS attivo senza regole, quindi le chiavi pubbliche di Supabase non possono leggerle.

### 6.1 Crea il progetto e collega la CLI

1. Su <https://supabase.com/dashboard> crea un progetto (piano gratuito). Copia il **Project ref**: è la parte `xxxx` di `https://xxxx.supabase.co` (anche in *Project Settings → General*).
2. Dalla cartella del progetto:

   ```bash
   npx supabase login
   npx supabase link --project-ref <IL_TUO_REF>
   ```

3. `supabase/config.toml` ha `project_id = "spotify-stats"`: è solo il nome locale per la CLI, non il ref del progetto remoto (quello lo imposta `link`). Cambialo solo se ti serve un nome diverso. La stessa sezione dichiara `verify_jwt = false` per ogni funzione.

### 6.2 Crea le tabelle

```bash
npx supabase db push
```

(Se la CLI non sa a quale progetto puntare, aggiungi `--linked`/`--remote` come richiesto dal messaggio; gli script del progetto usano `--remote`.) Applica le migrazioni in `supabase/migrations/`, in ordine:

| Migrazione | Cosa crea |
|---|---|
| `…_plays.sql` | `plays` (ascolti per utente Spotify) e `sync_meta` |
| `…_registrations.sql` | `registrations`: email registrate, collegate all'id Spotify |
| `…_friends.sql` | `friendships` (richieste e amicizie), nome e avatar in `registrations` |
| `…_server_sync.sql` | estensioni `pg_cron` e `pg_net`; `spotify_tokens` (refresh token, solo sul server) e `device_keys` (hash delle chiavi dei dispositivi) |
| `…_friend_playlists.sql` | `cloud_playlists` e `cloud_playlist_items`: cache delle playlist per gli amici |
| `…_privacy.sql` | `privacy_settings`: cosa vedono gli amici |
| `…_recommendations.sql` | `recommendations`: brani consigliati agli amici |

Le migrazioni abilitano da sole `pg_cron` e `pg_net` (`create extension if not exists …`). Se il push ti segnala un errore su un'estensione, abilitale da *Database → Extensions* nel dashboard e ripeti il comando. Dopo un aggiornamento del progetto che aggiunge tabelle esegui sempre prima `db push` e poi il deploy della funzione.

### 6.3 Pubblica le funzioni

```bash
npx supabase functions deploy sync --no-verify-jwt --use-api
npx supabase functions deploy register --no-verify-jwt --use-api
npx supabase functions deploy friends --no-verify-jwt --use-api
npx supabase functions deploy token --no-verify-jwt --use-api
npx supabase functions deploy translate --no-verify-jwt --use-api   # solo se vuoi la traduzione
```

**Perché `--no-verify-jwt`:** di default Supabase rifiuta le richieste senza un JWT di Supabase Auth. Qui non c'è nessun login Supabase: ogni funzione verifica da sé il token Spotify (`Authorization: Bearer <token Spotify>`), e `token` in modalità `poll` verifica l'header `x-cron-secret`. Senza il flag, tutte le richieste verrebbero respinte con 401.

### 6.4 Segreti delle funzioni

| Segreto | Serve a | Come ottenerlo |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | funzione `token` (rinnovo dei token sul server) | il Client ID dell'app Spotify (pubblico) |
| `CRON_SECRET` | proteggere l'azione `poll` di `token` | stringa casuale: `openssl rand -hex 32` |
| `DEEPL_API_KEY` | funzione `translate` | vedi sotto |

```bash
npx supabase secrets set SPOTIFY_CLIENT_ID=IL_TUO_CLIENT_ID CRON_SECRET=LA_STRINGA_CASUALE
npx supabase secrets set DEEPL_API_KEY=LA_TUA_CHIAVE:fx
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sono forniti automaticamente da Supabase alle funzioni.

**Chiave DeepL (gratuita):** vai su <https://www.deepl.com/pro-api>, scegli **DeepL API Free** e crea l'account (serve una carta per la verifica, non viene addebitato nulla nel piano Free). Poi *Account → API Keys*: copia la chiave, che per il piano Free **finisce con `:fx`**. Il piano Free include **500.000 caratteri al mese**; oltre quel limite la funzione risponde con un errore di quota e l'app mostra «Limite di traduzione raggiunto».

### 6.5 Sincronizzazione sul server (con l'app chiusa)

Ogni dispositivo, dopo l'accesso, consegna il suo refresh token alla funzione `token` e tiene solo una chiave dispositivo casuale. Il server rinnova i token e ogni 15 minuti salva gli ultimi ascolti di tutti gli utenti. Richiede i segreti `SPOTIFY_CLIENT_ID` e `CRON_SECRET` del punto 6.4 (con lo **stesso** valore di `CRON_SECRET` nel Vault) e la funzione `token` pubblicata.

**Windows (PowerShell), automatico.** Dalla cartella del progetto, con `.env.local` compilato (`EXPO_PUBLIC_SPOTIFY_CLIENT_ID` e `EXPO_PUBLIC_SYNC_URL`) e dopo `npx supabase link`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-server-sync.ps1
```

Lo script (`scripts/deploy-server-sync.ps1`): genera un segreto casuale da 64 caratteri esadecimali, esegue `db push`, imposta i segreti `SPOTIFY_CLIENT_ID` e `CRON_SECRET`, pubblica la funzione `token`, poi **copia negli appunti** lo SQL da incollare nel *SQL Editor* di Supabase (e premere *Run*).

**macOS / Linux (o a mano), gli stessi passi:**

```bash
SECRET=$(openssl rand -hex 32)
npx supabase db push
npx supabase secrets set SPOTIFY_CLIENT_ID=IL_TUO_CLIENT_ID CRON_SECRET=$SECRET
npx supabase functions deploy token --no-verify-jwt --use-api
echo $SECRET     # ti serve nel prossimo passo
```

Poi, nel *SQL Editor* di Supabase (sostituisci i due segnaposto: il segreto deve essere lo stesso di `CRON_SECRET`):

```sql
select vault.create_secret('<IL_SEGRETO_DI_PRIMA>', 'cron_secret');
select cron.schedule('spotify-poll', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<IL_TUO_REF>.supabase.co/functions/v1/token',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"action":"poll"}'::jsonb)
$$);
```

Senza questa parte l'app funziona comunque: ogni dispositivo si aggiorna da solo.

### 6.6 Imposta l'URL nell'app

In `.env.local`:

```
EXPO_PUBLIC_SYNC_URL=https://<IL_TUO_REF>.supabase.co/functions/v1/sync
```

Le altre funzioni (`token`, `friends`, `register`, `translate`) si trovano da sole accanto a `sync`. Ricompila **tutte** le versioni (la variabile viene inserita nell'app al momento della build): `npm run pc` per il PC, una nuova build per il telefono.

Con la parte online attiva, al primo avvio l'app chiede l'email dell'account Spotify. Poi, al collegamento, la funzione `register` controlla che l'account Spotify abbia la stessa email; se la sincronizzazione online non è configurata la registrazione resta solo sul dispositivo. Un dispositivo resta legato all'account Spotify con cui ha sincronizzato la prima volta.

## 7. Avvio

```bash
npx expo start          # server di sviluppo (Metro)
npm run web             # versione web con ricaricamento: expo start --web --port 8081
npm run pc              # versione PC: esporta il web in dist/ e lo serve su http://127.0.0.1:8081
```

- **Versione PC** (`npm run pc`): compila il web in `dist/`, avvia `scripts/serve-web.mjs` su `http://127.0.0.1:8081` e apre il browser. Lascia il terminale aperto finché usi l'app. In Chrome o Edge puoi installarla come applicazione dal menu del browser.
  - Il database usa SQLite in WebAssembly, che richiede le intestazioni `Cross-Origin-Embedder-Policy` e `Cross-Origin-Opener-Policy`: `scripts/serve-web.mjs` e `metro.config.js` le impostano. Se pubblichi `dist/` su un altro server devi impostarle anche lì.
  - Niente sincronizzazione in background: l'app si aggiorna quando la apri e ogni 10 minuti. Con la sincronizzazione sul server attiva, gli ascolti arrivano comunque.
  - Il login avviene in una pagina intera di Spotify invece che in un popup.
- **Expo Go non basta.** L'app usa moduli nativi (login OAuth con schema personalizzato, background task, SecureStore, vibrazione) e uno schema proprio (`spotifystats://`): serve una **development build**.

  ```bash
  npx expo run:android            # compila e installa sul telefono/emulatore (serve Android Studio)
  npx expo run:ios                # solo su Mac
  npx expo start --dev-client     # poi avvia Metro per la development build
  ```

  Dopo aver aggiunto un modulo nativo o cambiato `app.json` va ricompilata: una build vecchia non si avvia con il codice nuovo. In alternativa puoi creare la development build nel cloud: `npx eas-cli@latest build --profile development --platform android` (il profilo `development` non è presente in `eas.json`: aggiungilo seguendo la [documentazione EAS](https://docs.expo.dev/develop/development-builds/create-a-build/)).

## 8. Build APK (e iOS)

Prima di compilare, cambia l'identificatore dell'app in `app.json` (`ios.bundleIdentifier` e `android.package`, ora `com.example.spotifystats`) con il **tuo** identificatore in notazione DNS inversa (per esempio `it.tuonome.spotifystats`). Devono essere univoci e, una volta pubblicata l'app, non vanno più cambiati. Aggiorna di conseguenza i Redirect URI solo se cambi anche `scheme`.

### Locale, senza account Expo

Con Android Studio installato:

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a      # Windows: gradlew.bat assembleRelease …
```

L'APK esce in `android/app/build/outputs/apk/release/app-release.apk`. Copialo sul telefono e installalo (Android chiede di consentire le app da fonti sconosciute). Prende Client ID e URL di sincronizzazione da `.env.local` al momento della build.

Note:
- **JDK e SDK:** Android Studio include un JDK (`<cartella di Android Studio>/jbr`). Imposta `JAVA_HOME` su quella cartella e `ANDROID_HOME` sulla cartella dell'SDK (di solito `%LOCALAPPDATA%\Android\Sdk` su Windows, `~/Library/Android/sdk` su macOS, `~/Android/Sdk` su Linux). Esempio PowerShell: `$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"`.
- **Windows e percorsi lunghi:** i percorsi dei file C++ superano facilmente il limite di 260 caratteri. Compila da una cartella corta (per esempio una copia del progetto in `C:\build`). Il plugin `plugins/withAndroidBuildFixes.js` imposta già `CMAKE_OBJECT_PATH_MAX` e disattiva R8 (che rompeva WorkManager all'avvio), e `react-native.config.js` esclude i moduli nativi che l'app non usa (gesture-handler, reanimated, worklets).
- Le cartelle `android/` e `ios/` sono generate (`prebuild`) e ignorate da git: non vanno modificate a mano, la configurazione nativa sta in `app.json` e nei config plugin in `plugins/`.
- Senza una tua chiave l'APK è firmato con la chiave di debug: vedi [Firma dell'app](#9-firma-dellapp).

### Con EAS (nel cloud)

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android
```

`eas.json` ha due profili: `preview` (APK installabile direttamente) e `production`. In entrambi i valori di `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` ed `EXPO_PUBLIC_SYNC_URL` sono **segnaposto** (`<YOUR_SPOTIFY_CLIENT_ID>`, `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/sync`): sostituiscili con i tuoi valori, oppure rimuovi i blocchi `env` e definisci le variabili come *environment variables* di EAS (dashboard Expo → progetto → Environment variables, oppure `eas env:create`), che non finiscono nel repository. Con `build` EAS ti guida nella creazione del progetto e nella gestione della chiave di firma (vedi sotto). I file `.env.local` non vengono inviati al cloud: le variabili vanno in `eas.json` o nelle variabili EAS.

### iOS

Serve un Mac (`npx expo run:ios`) oppure EAS con un account Apple Developer a pagamento. L'app non è stata verificata su iOS dall'autore di questa guida: aspettati di dover sistemare qualche dettaglio.

## 9. Firma dell'app

Senza configurazione, `expo prebuild` genera un progetto Android che firma la release con la **chiave di debug** (`android/app/debug.keystore`), che è **pubblica** (è quella standard di React Native, con password `android`). Chiunque può firmare un APK falso che Android accetta come aggiornamento dell'app e che leggerebbe i dati salvati, compresa la chiave dispositivo. Per un uso serio crea la tua chiave **subito**, prima di distribuire l'app: dopo, ogni utente dovrà disinstallare e reinstallare. Vedi [`docs/sicurezza.md`](docs/sicurezza.md).

**Con EAS**: alla prima `eas build` per Android EAS può generare e custodire un keystore per te (`npx eas-cli@latest credentials` per gestirlo o scaricarne una copia). È la via più semplice.

**In locale**, con una chiave tua:

1. Genera il keystore **fuori dal repository** e fanne un backup sicuro (se lo perdi non potrai più aggiornare l'app):

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore spotify-stats-release.jks \
     -alias spotify-stats -keyalg RSA -keysize 2048 -validity 10000
   ```

   (`keytool` è nel JDK di Android Studio, cartella `jbr/bin`.) I file `*.jks` sono già in `.gitignore`.

2. Metti le credenziali in `~/.gradle/gradle.properties` (il file globale di Gradle, **non** quello del progetto):

   ```
   RELEASE_STORE_FILE=C:/percorso/sicuro/spotify-stats-release.jks
   RELEASE_STORE_PASSWORD=...
   RELEASE_KEY_ALIAS=spotify-stats
   RELEASE_KEY_PASSWORD=...
   ```

3. Dato che `android/` è rigenerata a ogni `prebuild`, usa un config plugin per usarle. Esempio, da salvare come `plugins/withReleaseSigning.js` e da aggiungere a `plugins` in `app.json` (`"./plugins/withReleaseSigning"`). Aggiunge una `signingConfig` `release` e la usa solo se le proprietà `RELEASE_*` sono presenti, altrimenti torna alla chiave di debug:

   ```js
   const { withAppBuildGradle } = require('expo/config-plugins');

   const RELEASE_CONFIG = `        release {
               if (project.hasProperty('RELEASE_STORE_FILE')) {
                   storeFile file(RELEASE_STORE_FILE)
                   storePassword RELEASE_STORE_PASSWORD
                   keyAlias RELEASE_KEY_ALIAS
                   keyPassword RELEASE_KEY_PASSWORD
               }
           }
   `;

   module.exports = function withReleaseSigning(config) {
     return withAppBuildGradle(config, (cfg) => {
       let c = cfg.modResults.contents;
       if (!c.includes('RELEASE_STORE_FILE')) {
         c = c.replace(/(signingConfigs \{\n[\s\S]*?\n        \}\n)(    \})/, `$1${RELEASE_CONFIG}$2`);
         c = c.replace(
           /(release \{\n[^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/,
           `$1signingConfig project.hasProperty('RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
         );
         cfg.modResults.contents = c;
       }
       return cfg;
     });
   };
   ```

   Questo esempio è stato provato sul modello `build.gradle` generato da `expo prebuild` con Expo SDK 58; con altre versioni di Expo controlla il risultato in `android/app/build.gradle` dopo il `prebuild`.

4. Rigenera e compila: `npx expo prebuild --platform android --clean`, poi `./gradlew assembleRelease`.

Non committare mai keystore, password o `gradle.properties` con le credenziali.

## 10. Test e qualità

```bash
npx tsc --noEmit    # typecheck (npm run typecheck)
npx expo lint       # lint (npm run lint)
npm test            # Jest con jest-expo (jest)
npx expo-doctor     # controllo delle dipendenze
```

I test stanno accanto al codice (`src/**/*.test.ts`). Coprono i calcoli su periodi e statistiche, il parser della cronologia, il riepilogo annuale, le traduzioni dell'interfaccia, il registro errori, i testi e «In riproduzione ora». Le query di `src/lib/db.ts` girano su un vero database SQLite in memoria (`src/testing/fakeSqlite.ts`, basato su `node:sqlite`: serve Node 22 o più recente). `npm test` fallisce anche se una frase usata nel codice con `t('…')` non ha la traduzione inglese in `src/lib/locales/en.ts`.

## 11. Risoluzione problemi

| Sintomo | Causa e rimedio |
|---|---|
| Spotify mostra **`INVALID_CLIENT: Invalid redirect URI`** | Il Redirect URI non coincide. Aggiungi esattamente quello mostrato nella schermata di accesso dell'app (di solito `spotifystats://callback` sul telefono, `http://127.0.0.1:8081/callback` sul PC) in *Redirect URIs* e salva. Sul PC usa `127.0.0.1`, non `localhost`; la porta deve coincidere. |
| Errore **403** o «utente non autorizzato» dopo il login | L'email del tuo account Spotify non è in *User Management* dell'app (Development mode, massimo 25 utenti). Aggiungila e riprova. |
| «In riproduzione ora» non compare, gli amici non vedono cosa ascolti | Manca il permesso `user-read-currently-playing` (account collegato prima di questa funzione): esci e **accedi di nuovo** dall'app. |
| «**Traduzione non configurata**» | La funzione `translate` non ha il segreto `DEEPL_API_KEY` (o non è pubblicata): `npx supabase secrets set DEEPL_API_KEY=…:fx` e `npx supabase functions deploy translate --no-verify-jwt --use-api`. Se l'app non ha `EXPO_PUBLIC_SYNC_URL` / `EXPO_PUBLIC_TRANSLATE_URL` la traduzione non è disponibile. |
| «**Limite di traduzione raggiunto**» | Hai finito i 500.000 caratteri mensili del piano DeepL API Free: aspetta il mese successivo o passa a un piano a pagamento. |
| Le funzioni rispondono 401 | Pubblicate senza `--no-verify-jwt`: ripubblica con il flag. |
| La build Windows fallisce con percorsi troppo lunghi (CMake/Ninja, 260 caratteri) | Compila da una cartella corta (es. `C:\build`) e tieni attivo `plugins/withAndroidBuildFixes.js`. Puoi anche abilitare i percorsi lunghi di Windows. |
| `tsc` segnala rotte inesistenti (typed routes non aggiornati) | I tipi delle rotte sono generati da Expo Router: avvia una volta `npx expo start` (poi chiudilo) per rigenerarli. |
| Le variabili `EXPO_PUBLIC_*` sembrano ignorate | Sono inserite al momento della build: riavvia con `npx expo start -c` o ricompila. |
| L'app sul telefono non si apre con il codice nuovo | Hai aggiunto un modulo nativo o cambiato `app.json`: ricompila la development build. |
| La sincronizzazione sul server non parte | Controlla `CRON_SECRET` (stesso valore nei segreti e nel Vault), che il cron `spotify-poll` esista (`select * from cron.job;` nel SQL Editor) e che la funzione `token` sia pubblicata. |

## 12. Privacy e sicurezza

- Le tabelle Supabase hanno RLS attivo senza regole: leggono e scrivono solo le Edge Functions con la chiave di servizio, che non è mai nell'app.
- Le funzioni chiedono a Spotify a chi appartiene il token ricevuto prima di fare qualsiasi cosa. L'app chiede solo permessi di **sola lettura**.
- Il refresh token resta solo sul server (`spotify_tokens`); il dispositivo tiene una chiave casuale di cui il server salva solo lo SHA-256. Il cron è protetto da un segreto confrontato a tempo costante.
- Gli amici vedono solo ciò che concedi in *Impostazioni → Cosa vedono gli amici*, applicato dal server.
- **I testi dei brani non vengono mai salvati**: li scarica il dispositivo da LRCLIB (a cui invia titolo, artista, album e durata), la traduzione passa dalla funzione `translate` a DeepL solo su richiesta, senza log né database, e resta solo in memoria.
- Il registro errori è locale, con token ed email oscurati, e viene condiviso solo se lo scegli tu.
- **Attenzione:** se non crei una tua chiave di firma, l'APK usa la chiave di debug pubblica (vedi [Firma dell'app](#9-firma-dellapp)).

Valutazione completa, punti deboli noti e miglioramenti proposti: [`docs/sicurezza.md`](docs/sicurezza.md).

## 13. Note legali

- **Questo progetto non è affiliato, sponsorizzato né approvato da Spotify.** «Spotify» è un marchio registrato di Spotify AB. Il nome «Spotify Stats» descrive solo ciò che l'app fa; se pubblichi una tua versione valuta se cambiare nome e icona.
- L'uso dell'API è soggetto ai [Termini per sviluppatori Spotify](https://developer.spotify.com/terms) e alle sue linee guida: rispettale (tra l'altro, non usare i dati Spotify per addestrare modelli di machine learning e rispetta i limiti dell'app in Development mode). Sei responsabile della tua app Spotify e dei dati dei tuoi utenti.
- **Testi dei brani:** sono protetti da copyright. [LRCLIB](https://lrclib.net) è un servizio gestito dalla comunità; l'app lo interroga **solo dal dispositivo** dell'utente, per visualizzare il testo del brano che sta già ascoltando, e **non salva né ridistribuisce** nulla. Non usare questa funzione in un prodotto commerciale o distribuito su larga scala senza una licenza adeguata per i testi.
- **Traduzione:** usa DeepL; valgono i [termini di DeepL](https://www.deepl.com/pro-license). Il testo inviato viene inoltrato a DeepL su richiesta dell'utente.
- Il software è fornito «così com'è», senza garanzie (vedi licenza).

## 14. Contribuire

Contributi, segnalazioni di bug e proposte sono benvenuti tramite issue e pull request. Prima di aprire una pull request:

1. Esegui `npx tsc --noEmit`, `npx expo lint` e `npm test`: devono passare.
2. Ogni frase mostrata all'utente passa da `t('…')` (`src/lib/i18n.ts`, la frase italiana fa da chiave) e ha la traduzione inglese in `src/lib/locales/en.ts`; per i plurali c'è `plural(n, '{n} brano', '{n} brani')`, per le costanti a livello di modulo `msg('…')` e poi `t()` al momento di mostrarle.
3. Le tabelle nuove vanno in una nuova migrazione in `supabase/migrations/`, con RLS attivo e permessi di `anon`/`authenticated` revocati.
4. Non committare mai chiavi, token, file `.env.local` o keystore. Per vulnerabilità di sicurezza apri una segnalazione privata invece di una issue pubblica.

Per orientarti: `src/app/` contiene le schermate (Expo Router), `src/components/` i componenti, `src/lib/` la logica (`db.ts` schema e query SQLite, `spotify.ts` PKCE e chiamate API, `cloudSync.ts` sincronizzazione, `i18n.ts`, `theme.ts`, `settings.ts`, …), `src/recap/` le storie del riepilogo, `supabase/` migrazioni e funzioni, `scripts/` gli script di servizio.

## 15. Licenza

[MIT](LICENSE). Copyright (c) 2026 Spotify Stats contributors.
