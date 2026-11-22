# 🏁 Folkrace 2026 – Tävlingsanmälan

En färdig, responsiv webbsida för Roblox Folkrace med gemensam databas. Byggd utan externa npm-paket.

## Starta på din dator

1. Installera **Node.js 22.13 eller senare** (helst aktuell LTS).
2. Öppna en terminal i mappen där `server.js` ligger.
3. Kör `npm start` (eller `node server.js`).
4. Öppna http://localhost:3000 i webbläsaren.

Databasen skapas automatiskt i `data/folkrace.sqlite`. Alla konton, tävlingar och anmälningar ligger kvar efter omstart. Gör regelbundna säkerhetskopior av data-mappen.

## Lägg ut hemsidan så alla kan använda den

Det här är en **Node-webbserver**, inte bara statiska HTML-filer. Kör projektet på en server eller en hostingtjänst som stöder Node.js 22+ och beständig disk/volym (t.ex. en VPS). Ange `PORT` om servermiljön kräver det. Använd HTTPS och sätt `COOKIE_SECURE=1` för säkra sessionscookies. Exponera serverns port via hostingleverantörens domän eller reverse proxy.

**VIKTIGT:** Statiska hoster som vanliga GitHub Pages fungerar inte för denna version eftersom de saknar server och databas. En server utan beständig disk kan förlora alla anmälningar vid omstart/omdistribution. På en host med flera instanser behövs i stället en extern fleranvändardatabas.

## Funktioner

- Skapa konto med ett Roblox-användarnamn och separat lösenord.
- Logga in och logga ut (httpOnly sessionscookies, hashade lösenord).
- Publicera tävlingar (namn, bana, datum/tid, klass, maxantal, kvalomgångar och regler).
- Sök och filtrera tävlingar, inklusive kommande, öppna och alla.
- Anmäl dig med bilmodell, startnummer och team.
- Live-startlistor: alla besökare ser samma information via servern.
- Bara en anmälan per användare och tävling, begränsat antal platser.
- Arrangören kan stänga/öppna anmälan, ställa in tävling och ta bort anmälningar.
- Förare kan avanmäla sig innan tävlingen börjar.
- Kopiera startlistan som text.
- Anpassad mobil- och datorlayout.

## Begränsningar i första versionen

- Användarnamn är **inte verifierade genom Roblox**. En användare kan skriva in ett namn som tillhör någon annan. För en offentlig community bör Roblox OAuth införas före lansering om identiteterna måste vara betrodda.
- Alla med konto får lägga upp tävlingar. Det finns ingen administratörsmoderering eller tävlingsgodkännande ännu.
- Startspår, heatindelning, betalningar, automatiska Roblox-serverlänkar, e-postpåminnelser och anbudssystem är inte kopplade till hemsidan.
- Webbplatsen är ett första fungerande community-system, inte säkerhetsgranskat för stor publik trafik. Komplettera med t.ex. backup, driftövervakning, starkare anti-spam och verifiering före stor lansering.

## Din roll som admin

Roblox UserId `103803542` gäller i dina **Roblox-spelscript**. Webbplatsen använder egna konton och har ännu inte Roblox-ID-koppling eller adminroll. Den som skapar en tävling kan administrera just den tävlingen.

## Säkerhet / drift

Använd alltid HTTPS i produktion. Exponera aldrig `data/` offentligt. Kör gärna som en begränsad användare och ta backup av databasen. Om trafik kommer via proxy, se till att proxykonfigurationen är korrekt. Webbservern kontrollerar inmatning och behörigheter på servern, men är tänkt som en tydlig MVP.
