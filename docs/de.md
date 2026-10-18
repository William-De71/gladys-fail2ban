# Fail2Ban

## Überblick

[Fail2Ban](https://github.com/fail2ban/fail2ban) überwacht die Logs eines Servers und sperrt Adressen, die zu viele Passwörter ausprobieren. Diese Integration holt es in Gladys: die gesperrten IPs und die Fehlversuche jeder Jail als Geräte, ein Szenen-Auslöser, wenn eine IP gesperrt oder entsperrt wird oder Fail2Ban nicht mehr antwortet, Szenen-Aktionen zum Sperren, Entsperren oder Prüfen einer Adresse und zwei Dashboard-Widgets mit Schaltflächen zum Sperren und Entsperren.

Fail2Ban antwortet nur auf dem Rechner, den es schützt (ein Unix-Socket). Die Integration verbindet sich deshalb per **SSH** mit diesem Rechner und führt dort `fail2ban-client` aus, wie du es in einem Terminal tun würdest. Sie funktioniert mit Fail2Ban 0.10 bis 1.1, als Paket oder in Docker installiert, auf dem Gladys-Rechner oder auf jedem anderen per SSH erreichbaren Rechner.

## Voraussetzungen

- Gladys Assistant **5.2.0** oder neuer (Widget-Schaltflächen mit Formular). Ältere Instanzen können die Integration nicht installieren.
- Ein Rechner mit Fail2Ban und einem SSH-Server, und seine Adresse in deinem Netzwerk.
- Ein SSH-Benutzer, der `fail2ban-client` ohne Passwort ausführen darf (siehe unten).

### Den Server vorbereiten

Führe diese Befehle auf dem Fail2Ban-Server als root aus (Debian, Ubuntu, Raspberry Pi OS; den Pfad von `fail2ban-client` mit `command -v fail2ban-client` anpassen):

```bash
# 1. Ein eigener Benutzer ohne eigenes Passwort
adduser --disabled-password --gecos "" gladys

# 2. Ihm erlauben, fail2ban-client als root auszuführen, und nichts anderes
echo 'gladys ALL=(root) NOPASSWD: /usr/bin/fail2ban-client' > /etc/sudoers.d/gladys-fail2ban
chmod 440 /etc/sudoers.d/gladys-fail2ban

# 3. Seine authorized_keys vorbereiten
install -d -m 700 -o gladys -g gladys /home/gladys/.ssh
```

Fülle danach in Gladys die Konfiguration aus (unten), speichere und klicke auf **Öffentlichen Schlüssel anzeigen**. Trage die angezeigte Zeile in `/home/gladys/.ssh/authorized_keys` ein (Eigentümer `gladys`, Rechte 600). Sie beginnt mit `restrict`, das diesem Schlüssel Portweiterleitungen und Terminals verbietet. Klicke zum Schluss auf **Verbindung testen**.

- **Fail2Ban in Docker** (zum Beispiel `crazymax/fail2ban`): setze den Befehl auf `docker exec fail2ban fail2ban-client`. Der SSH-Benutzer muss diesen Befehl dann ausführen dürfen (sudoers oder die Gruppe `docker`, was root gleichkommt).
- **Anmeldung als root**: setze den Befehl auf `fail2ban-client`.
- **Passwort statt Schlüssel**: wähle die Authentifizierung **Passwort**. Ein Schlüssel ist sicherer.

## Konfiguration

| Feld                   | Was einzutragen ist                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Adresse des Servers    | Seine IP-Adresse oder sein Hostname in deinem Netzwerk: `192.168.1.10`. Nicht `localhost`, das ist der Container der Integration.   |
| SSH-Port               | 22, außer dein SSH-Server lauscht woanders.                                                                                         |
| SSH-Benutzer           | Der oben vorbereitete Benutzer: `gladys`.                                                                                           |
| Authentifizierung      | **Schlüssel der Integration** (empfohlen) oder **Passwort**.                                                                        |
| SSH-Passwort           | Nur mit der Authentifizierung per Passwort. Als Geheimnis gespeichert, nie wieder angezeigt oder protokolliert.                     |
| Befehl fail2ban-client | Standardmäßig `sudo -n fail2ban-client`. Die Integration hängt die Argumente selbst maskiert an.                                    |
| Hostschlüssel          | Optional: der SHA256-Fingerabdruck des Servers (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). Leer: der erste wird behalten. |
| Zu verfolgende Jails   | `sshd, recidive`, um nur diese Jails als Geräte anzubieten. Leer: alle Jails.                                                       |
| Leseintervall          | Alle 30 Sekunden, jede Minute, alle 2 Minuten oder alle 5 Minuten.                                                                  |
| Sprache der Texte      | Gerätenamen und die an Szenen übergebenen Texte. Automatisch: die Sprache des zuletzt angezeigten Widgets.                          |

Die Konfigurationsseite hat außerdem vier Schaltflächen: **Verbindung testen**, **Öffentlichen Schlüssel anzeigen**, **Hostschlüssel vergessen** (nach einer Neuinstallation des Servers: die nächste Verbindung vertraut dem neuen Schlüssel) und **Diagnose** (der Zustand der Integration in ihren Logs, ohne Geheimnisse).

## Verwendung

### Geräte

Öffne den Tab **Entdecken** der Integration und lege die gewünschten Geräte an:

- **Fail2Ban <Server>**: gesperrte IPs (alle Jails), aktuelle Fehlversuche, Sperren seit dem Start von Fail2Ban, aktive Jails.
- **Fail2Ban-Jail <Name>**, eines pro Jail: gesperrte IPs, aktuelle Fehlversuche, Sperren und Fehlversuche seit dem Start von Fail2Ban, zuletzt gesperrte IP.

Die Zähler behalten ihren Verlauf: ein Diagramm der gesperrten IPs von `sshd` über eine Woche zeigt die Angriffswellen. Die Zähler „seit dem Start“ beginnen bei null, wenn Fail2Ban neu startet.

### Dashboard-Widgets

![Das Widget Fail2Ban mit vier Jails und seinen Schaltflächen und das Widget Fail2Ban-Sperren mit sechs gesperrten Adressen (generierte Illustration, kein Bildschirmfoto)](https://raw.githubusercontent.com/William-De71/gladys-fail2ban/main/docs/assets/widgets.de.png)

- **Fail2Ban**: die gesperrten IPs, die Fehlversuche, die Summe der Sperren, eine Zeile pro Jail (rot mit Sperren, orange mit Fehlversuchen) und die Schaltflächen **IP sperren** (Adresse und Jail), **Entsperren** (Adresse, eine Jail oder alle) und **Aktualisieren**.
- **Fail2Ban-Sperren**: die letzten Sperren, die neueste zuerst, mit ihrer Jail, seit wann, und was von der Sperre bleibt (oder „dauerhaft“). Ein Tippen zeigt die Details. **Entsperren** bietet die aufgelisteten Adressen an. Einstellungen: nur eine Jail, Anzahl der angezeigten Sperren (1 bis 8).

### Szenen

Auslöser:

- **Fail2Ban: IP gesperrt**: eine IP kommt auf die Sperrliste einer Jail. Filter: Jail, Adresse (deine eigene, um sofort gewarnt zu werden). Variablen: `ip`, `jail`, `banned_count`, `total_banned`, `ban_seconds`, `permanent`, `until`, `server`.
- **Fail2Ban: IP entsperrt**: ihre Sperre ist abgelaufen oder wurde aufgehoben. Filter: Jail, Adresse.
- **Fail2Ban: Server nicht erreichbar**: Fail2Ban antwortet nicht mehr. Filter: Grund (Server nicht erreichbar, Fail2Ban gestoppt, SSH-Anmeldung abgelehnt, Hostschlüssel geändert, Rechte verweigert, Sonstiges). Ein Server, der nicht antwortet, gilt erst beim zweiten fehlgeschlagenen Lesen in Folge als ausgefallen: ein Neustart löst keinen Alarm aus.
- **Fail2Ban: Server wieder da**: er antwortet wieder.

Aktionen: **IP sperren** (eine Adresse oder ein Netz wie `192.0.2.0/24`, in einer Jail), **IP entsperren** (in einer Jail oder in allen), **IP prüfen** (gesperrt oder nicht, und in welchen Jails), **Zusammenfassung lesen** (Zähler und ein fertiger Satz).

Beispiele:

- Wenn **eine IP in `recidive` gesperrt wird** → `{{triggerEvent.data.ip}} gesperrt bis {{triggerEvent.data.until}}` an dein Handy senden.
- Wenn **die gesperrte IP deine eigene öffentliche Adresse ist** → sie sofort **entsperren** und dir eine Nachricht schicken.
- Jeden Montag um 8:00 → **Zusammenfassung lesen** und die Ausgabe `summary` als Nachricht senden.

Sperren und Entsperren durch Gladys (Szenen-Aktionen und Widget-Schaltflächen) lösen nichts aus: eine Szene kann sich nicht an ihrer eigenen Aktion aufschaukeln. Eine Sperre, die kürzer als das Leseintervall ist, kann zwischen zwei Lesungen kommen und gehen: dann gibt es keinen Auslöser.

### Transport

Lokal (`"transports": ["local"]`): Die Integration verbindet sich direkt mit dem angegebenen Server, nichts läuft über eine Cloud. Steht dieser Server außer Haus (ein VPS), läuft die SSH-Verbindung verschlüsselt über das Internet. Auf dem Server werden nur die Befehle von `fail2ban-client` ausgeführt; der private Schlüssel der Integration bleibt in ihrem Volume `/data`.

## Fehlerbehebung

- **Keine SSH-Verbindung**: prüfe die Adresse (die LAN-Adresse des Rechners, weder `localhost` noch `127.0.0.1`) und den Port, und ob der Server SSH vom Gladys-Rechner annimmt.
- **SSH hat den Benutzer abgelehnt**: der öffentliche Schlüssel fehlt in `authorized_keys`, oder die Datei hat falsche Rechte (`chmod 600`, Eigentümer der Benutzer). Sieh in `/var/log/auth.log` auf dem Server nach.
- **sudo verlangt ein Passwort**: die sudoers-Regel fehlt oder nennt einen anderen Pfad (`command -v fail2ban-client`). Teste auf dem Server: `sudo -u gladys sudo -n fail2ban-client ping`.
- **Permission denied to socket**: `fail2ban-client` läuft ohne root: behalte `sudo -n` im Befehl.
- **Der Hostschlüssel hat sich geändert**: nach einer Neuinstallation normal: klicke auf **Hostschlüssel vergessen**. Sonst zuerst die Ursache klären.
- **Uhrzeiten um ein oder zwei Stunden verschoben**: die Integration liest die Zeiten von Fail2Ban in der Zeitzone von Gladys und korrigiert sich bei der ersten Sperre, die sie entstehen sieht.
- **Weiterhin Probleme**: klicke auf **Diagnose** und eröffne ein Issue auf [GitHub](https://github.com/William-De71/gladys-fail2ban/issues) mit den Versionen von Gladys, der Integration und von Fail2Ban sowie den Zeilen „Fail2Ban diagnostic“ aus den Logs (im Entwicklermodus `DEBUG=gladys-integration-sdk` hinzufügen).
