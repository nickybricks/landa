# Post-Mortem: „Windows fügt nichts ein" — 2026-05-16

## Kurzfassung

Ein Windows-Test-User meldete: nach dem Update funktioniert das Mikrofon,
aber es wird kein Text eingefügt. Nach mehreren Iterationen stellte sich
heraus: Das Problem hatte **nichts** mit dem Paste-/Clipboard-Mechanismus zu
tun. Der wahre Grund war eine **fehlende Modell-Datei im Windows-Build**,
wodurch die lokale Transkription abstürzte und leeren Text zurückgab. Es gab
schlicht nie etwas zum Einfügen.

- **Symptom:** Diktieren möglich, aber im Zielfeld erscheint nichts.
- **Vermutete Ursache (falsch):** Windows-Paste / Clipboard / Berechtigungen.
- **Tatsächliche Ursache:** `silero_vad_v6.onnx` (VAD-Modell von
  `faster_whisper`) wurde vom PyInstaller-Build nicht eingepackt →
  Transkription crasht → `text_len=0`.
- **Fix:** `--collect-data faster_whisper` in beiden Build-Skripten.
- **Outcome:** Bestätigt funktionierend ab v0.24.7.

---

## Zeitlicher Ablauf

### 1. Erste Meldung & Hypothese „Windows-Berechtigung"

Der User fragte, ob man — analog zu macOS — auf Windows eine Berechtigung
erneut anfragen könne, wenn Strg+V nicht erlaubt ist.

**Erkenntnis / Klarstellung:** Windows hat keine Accessibility-Permission wie
macOS' TCC. `SendInput` ist nicht gegated. Eine „Permission-Abfrage" wäre auf
Windows ein Fake-Dialog. Wir haben den Vorschlag bewusst **nicht** umgesetzt
und stattdessen nach der echten Ursache gesucht.

### 2. Hypothese „ctypes 64-bit Handle-Truncation"

Der Windows-Paste-Code nutzte Win32-Aufrufe via `ctypes` **ohne**
`argtypes`/`restype`. Das ist ein bekannter Bug: 64-bit-Handles werden auf
32-bit abgeschnitten → `SetClipboardData` schlägt still fehl.

User-Rückmeldung bestätigte scheinbar: Strg+V fügt nur alten Clipboard-Inhalt
ein → Clipboard wird nicht geschrieben. Wir haben `argtypes`/`restype` für
alle Win32-Calls deklariert und Fehlerprüfungen ergänzt (v0.24.1).

→ **Hat nicht geholfen.**

### 3. Hypothese „Python-Win32-Pfad generell kaputt"

Pivot: statt weiter ctypes zu debuggen, die macOS-Architektur gespiegelt —
Electron schreibt das Clipboard (`clipboard.writeText`) und triggert Strg+V
via PowerShell SendKeys; der Python-Backend-Pfad auf Windows wurde
neutralisiert (v0.24.2).

→ **Hat nicht geholfen.**

### 4. Sackgasse: Update kam nicht an

Der User installierte die neue `.exe`, sah aber weiterhin die alte Version.
Zwei separate Fehler:
- `package.json`-Version wurde bei einem Release nicht gebumpt → NSIS sah
  dieselbe interne Version und überschrieb nichts.
- Landa lief im Tray → laufende `.exe` ließ sich nicht ersetzen.

Behoben durch Versions-Korrektur + Hinweis „vor Installation Landa beenden".

### 5. Durchbruch: Logging sichtbar machen

Kern-Problem der gesamten Debugging-Phase: **In der gepackten App war jedes
`console.log` unsichtbar.** Wir haben blind Hypothesen getestet.

Lösung in mehreren Schritten:
- Paste-Debug-Log in eine Datei auf den **Desktop** schreiben (garantiert
  erreichbarer Ort für einen Nicht-Techniker).
- Erkenntnis aus dem Log: `/stop` liefert `text: null` — der Paste-Branch
  wurde nie betreten, weil es **keinen Text gab**.
- Backend-stdout/stderr ebenfalls auf den Desktop umgeleitet (v0.24.6).

### 6. Root Cause gefunden

Der Backend-Log zeigte den Stacktrace:

```
onnxruntime.capi.onnxruntime_pybind11_state.NoSuchFile:
[ONNXRuntimeError] : 3 : NO_SUCHFILE : Load model from
...\faster_whisper\assets\silero_vad_v6.onnx failed. File doesn't exist
```

`faster_whisper` liefert sein Silero-VAD-Modell unter
`faster_whisper/assets/`. Der PyInstaller-Build packte nur `landa-base.bin`
ein, nicht dieses Verzeichnis. Beim Laden des VAD-Modells crashte der
Transkriptions-Thread → leerer Text → nichts zum Einfügen.

Zusätzliche Hürde: Der `landa_backend.spec` ist **gitignored** und wird von
CI gar nicht genutzt. CI ruft `pyinstaller` direkt mit CLI-Flags auf. Der
Fix musste daher in die Build-Skripte, nicht in den Spec.

### 7. Fix & Bestätigung (v0.24.7)

```
--collect-data faster_whisper
```

in `scripts/build_backend.ps1` **und** `scripts/build_backend.sh`.

Backend-Log nach dem Fix:

```
INFO: VAD filter removed 00:01.808 of audio
INFO: Detected language 'en' with probability 0.80
INFO: [/stop] responding in 16.986s, stopped=True, text_len=12
```

→ **Funktioniert.** (Die 17s Latenz sind die UTM-VM Windows-auf-Mac, kein
Code-Problem.)

---

## Root Cause (eine Zeile)

Der Windows-PyInstaller-Build bündelte das VAD-Modell von `faster_whisper`
nicht; die lokale Transkription stürzte ab und gab leeren Text zurück.

## Was wir geändert haben

| Datei | Änderung |
|---|---|
| `scripts/build_backend.ps1` | `--collect-data faster_whisper` ergänzt |
| `scripts/build_backend.sh` | `--collect-data faster_whisper` ergänzt |
| `backend/landa_backend.spec` | `collect_data_files('faster_whisper')` (Doku/lokal; CI nutzt den Spec nicht) |
| `main.js` (temporär) | Desktop-Debug-Logging für Paste + Backend |

## Outcome

- Lokale Transkription auf Windows funktioniert ab **v0.24.7**.
- Betraf vermutlich **alle** Windows-Nutzer mit lokalem Whisper, nicht nur
  den Test-User.
- Mac-Build erhielt denselben `--collect-data`-Zusatz — vor dem nächsten
  Mac-Release gegentesten.

## Offene Punkte

- [ ] Desktop-Debug-Logging (`landa-paste-debug.log`, `landa-backend.log`)
      im nächsten Release wieder entfernen — landet sonst auf jedem
      Windows-Desktop.
- [ ] macOS lokales Whisper nach `--collect-data`-Änderung verifizieren.

## Lessons Learned

1. **Symptom ≠ Ursache.** „Es wird nichts eingefügt" klang nach einem
   Paste-Problem; tatsächlich lag es an einem fehlenden Modell im Build. Drei
   Iterationen gingen in die falsche Richtung, weil wir die Annahme nicht
   früh genug hinterfragt haben.
2. **Ohne Logs debuggt man blind.** Der entscheidende Fortschritt kam erst,
   als wir Backend-Output in eine für den User erreichbare Datei umgeleitet
   haben. Sichtbare Diagnostik hätte am Anfang stehen müssen, nicht nach
   mehreren Rate-Releases.
3. **Build-Pipeline kennen.** Der gitignorete `.spec` war eine Falle — der
   Fix wäre wirkungslos gewesen, wenn wir nicht geprüft hätten, wie CI
   tatsächlich baut.
4. **Gebündelte ML-Dependencies brauchen explizite Daten-Collection.**
   Pakete wie `faster_whisper` liefern Modell-Assets aus, die PyInstaller
   nicht automatisch findet. Für solche Pakete gehört `--collect-data`
   standardmäßig in den Build.
