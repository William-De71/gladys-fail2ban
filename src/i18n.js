// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: device and feature names, widget contents, toasts, connection
// statuses, messages of the Configuration screen, scene texts. Vocabulary of
// the Gladys interface (appareil / Gerät / dispositivo) and of Fail2Ban, whose
// "jail" stays "jail" in every language, as its documentation and its users
// say it. Jail names and addresses are never translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // devices
  serverDeviceName: {
    en: 'Fail2Ban {host}',
    fr: 'Fail2Ban {host}',
    de: 'Fail2Ban {host}',
    es: 'Fail2Ban {host}',
  },
  jailDeviceName: {
    en: 'Fail2Ban jail {jail}',
    fr: 'Fail2Ban jail {jail}',
    de: 'Fail2Ban-Jail {jail}',
    es: 'Fail2Ban jail {jail}',
  },
  featureBannedAll: {
    en: 'IPs banned now (all jails)',
    fr: 'IP bannies (toutes les jails)',
    de: 'Gesperrte IPs (alle Jails)',
    es: 'IP bloqueadas (todas las jails)',
  },
  featureFailedAll: {
    en: 'Failures now (all jails)',
    fr: 'Échecs en cours (toutes les jails)',
    de: 'Aktuelle Fehlversuche (alle Jails)',
    es: 'Fallos actuales (todas las jails)',
  },
  featureTotalBanned: {
    en: 'Bans since Fail2Ban started',
    fr: 'Bannissements depuis le démarrage',
    de: 'Sperren seit dem Start',
    es: 'Bloqueos desde el arranque',
  },
  featureJails: {
    en: 'Jails running',
    fr: 'Jails actives',
    de: 'Aktive Jails',
    es: 'Jails activas',
  },
  featureBanned: {
    en: 'IPs banned now',
    fr: 'IP bannies',
    de: 'Gesperrte IPs',
    es: 'IP bloqueadas',
  },
  featureFailed: {
    en: 'Failures now',
    fr: 'Échecs en cours',
    de: 'Aktuelle Fehlversuche',
    es: 'Fallos actuales',
  },
  featureTotalFailed: {
    en: 'Failures since Fail2Ban started',
    fr: 'Échecs depuis le démarrage',
    de: 'Fehlversuche seit dem Start',
    es: 'Fallos desde el arranque',
  },
  featureLastBanned: {
    en: 'Last banned IP',
    fr: 'Dernière IP bannie',
    de: 'Zuletzt gesperrte IP',
    es: 'Última IP bloqueada',
  },

  // connection status and errors
  statusConnected: {
    en: 'Connected to Fail2Ban {version} on {host}: {jails}, {banned}.',
    fr: 'Connecté à Fail2Ban {version} sur {host} : {jails}, {banned}.',
    de: 'Verbunden mit Fail2Ban {version} auf {host}: {jails}, {banned}.',
    es: 'Conectado a Fail2Ban {version} en {host}: {jails}, {banned}.',
  },
  errConfig: {
    en: 'Enter the address and the SSH user of the Fail2Ban server in the configuration.',
    fr: 'Renseignez l’adresse et l’utilisateur SSH du serveur Fail2Ban dans la configuration.',
    de: 'Gib in der Konfiguration die Adresse und den SSH-Benutzer des Fail2Ban-Servers ein.',
    es: 'Introduzca la dirección y el usuario SSH del servidor Fail2Ban en la configuración.',
  },
  errUnreachable: {
    en: 'No SSH connection to {host}: check its address and port.',
    fr: 'Connexion SSH impossible vers {host} : vérifiez l’adresse et le port.',
    de: 'Keine SSH-Verbindung zu {host}: Adresse und Port prüfen.',
    es: 'Sin conexión SSH con {host}: compruebe la dirección y el puerto.',
  },
  errTimeout: {
    en: '{host} did not answer in time over SSH.',
    fr: '{host} n’a pas répondu à temps en SSH.',
    de: '{host} hat per SSH nicht rechtzeitig geantwortet.',
    es: '{host} no respondió a tiempo por SSH.',
  },
  errAuth: {
    en: 'SSH refused the user {user}: add the public key of the integration to its authorized_keys, or check the password.',
    fr: 'SSH a refusé l’utilisateur {user} : ajoutez la clé publique de l’intégration à son authorized_keys, ou vérifiez le mot de passe.',
    de: 'SSH hat den Benutzer {user} abgelehnt: den öffentlichen Schlüssel der Integration in seine authorized_keys eintragen oder das Passwort prüfen.',
    es: 'SSH rechazó al usuario {user}: añada la clave pública de la integración a su authorized_keys o compruebe la contraseña.',
  },
  errHostKey: {
    en: 'The SSH host key of {host} changed ({fingerprint}). If you expected it, use “Forget the host key”.',
    fr: 'La clé d’hôte SSH de {host} a changé ({fingerprint}). Si c’est attendu, utilisez « Oublier la clé d’hôte ».',
    de: 'Der SSH-Hostschlüssel von {host} hat sich geändert ({fingerprint}). Falls erwartet, nutze „Hostschlüssel vergessen“.',
    es: 'La clave de host SSH de {host} cambió ({fingerprint}). Si lo esperaba, use «Olvidar la clave de host».',
  },
  errSudo: {
    en: 'sudo asks for a password: allow fail2ban-client without a password for this user (see the documentation).',
    fr: 'sudo demande un mot de passe : autorisez fail2ban-client sans mot de passe pour cet utilisateur (voir la documentation).',
    de: 'sudo verlangt ein Passwort: fail2ban-client für diesen Benutzer ohne Passwort erlauben (siehe Dokumentation).',
    es: 'sudo pide una contraseña: permita fail2ban-client sin contraseña para este usuario (ver la documentación).',
  },
  errPermission: {
    en: 'fail2ban-client cannot open the socket of Fail2Ban: run it through sudo or as root.',
    fr: 'fail2ban-client ne peut pas ouvrir le socket de Fail2Ban : passez par sudo ou utilisez root.',
    de: 'fail2ban-client kann den Socket von Fail2Ban nicht öffnen: über sudo oder als root ausführen.',
    es: 'fail2ban-client no puede abrir el socket de Fail2Ban: ejecútelo con sudo o como root.',
  },
  errNotFound: {
    en: 'The command was not found on {host}: check the “fail2ban-client command” field.',
    fr: 'Commande introuvable sur {host} : vérifiez le champ « Commande fail2ban-client ».',
    de: 'Befehl auf {host} nicht gefunden: das Feld „Befehl fail2ban-client“ prüfen.',
    es: 'Comando no encontrado en {host}: compruebe el campo «Comando fail2ban-client».',
  },
  errNotRunning: {
    en: 'Fail2Ban is not running on {host}.',
    fr: 'Fail2Ban ne tourne pas sur {host}.',
    de: 'Fail2Ban läuft nicht auf {host}.',
    es: 'Fail2Ban no se está ejecutando en {host}.',
  },
  errUnknownJail: {
    en: 'The jail {jail} does not exist.',
    fr: 'La jail {jail} n’existe pas.',
    de: 'Die Jail {jail} existiert nicht.',
    es: 'La jail {jail} no existe.',
  },
  errInvalidIp: {
    en: '“{ip}” is not an IP address.',
    fr: '« {ip} » n’est pas une adresse IP.',
    de: '„{ip}“ ist keine IP-Adresse.',
    es: '«{ip}» no es una dirección IP.',
  },
  errFailed: {
    en: 'Fail2Ban refused the command: {detail}',
    fr: 'Fail2Ban a refusé la commande : {detail}',
    de: 'Fail2Ban hat den Befehl abgelehnt: {detail}',
    es: 'Fail2Ban rechazó el comando: {detail}',
  },

  // configuration actions
  testOk: {
    en: 'Connected to {host} (host key {fingerprint}). Fail2Ban {version}: {jails} ({names}), {banned}.',
    fr: 'Connecté à {host} (clé d’hôte {fingerprint}). Fail2Ban {version} : {jails} ({names}), {banned}.',
    de: 'Verbunden mit {host} (Hostschlüssel {fingerprint}). Fail2Ban {version}: {jails} ({names}), {banned}.',
    es: 'Conectado a {host} (clave de host {fingerprint}). Fail2Ban {version}: {jails} ({names}), {banned}.',
  },
  testFailed: {
    en: 'Test failed: {error}',
    fr: 'Échec du test : {error}',
    de: 'Test fehlgeschlagen: {error}',
    es: 'La prueba falló: {error}',
  },
  publicKey: {
    en: 'Add this line to the ~/.ssh/authorized_keys file of {user} on the Fail2Ban server: {key}',
    fr: 'Ajoutez cette ligne au fichier ~/.ssh/authorized_keys de {user} sur le serveur Fail2Ban : {key}',
    de: 'Füge diese Zeile der Datei ~/.ssh/authorized_keys von {user} auf dem Fail2Ban-Server hinzu: {key}',
    es: 'Añada esta línea al archivo ~/.ssh/authorized_keys de {user} en el servidor Fail2Ban: {key}',
  },
  publicKeyPassword: {
    en: 'The password is used (authentication “password”). To use a key instead, add this line to ~/.ssh/authorized_keys: {key}',
    fr: 'Le mot de passe est utilisé (authentification « mot de passe »). Pour une clé, ajoutez cette ligne à ~/.ssh/authorized_keys : {key}',
    de: 'Das Passwort wird verwendet (Authentifizierung „Passwort“). Für einen Schlüssel diese Zeile in ~/.ssh/authorized_keys eintragen: {key}',
    es: 'Se usa la contraseña (autenticación «contraseña»). Para usar una clave, añada esta línea a ~/.ssh/authorized_keys: {key}',
  },
  hostKeyForgotten: {
    en: 'The stored host key of {host} is forgotten: the next connection trusts the key it sees.',
    fr: 'La clé d’hôte mémorisée pour {host} est oubliée : la prochaine connexion fera confiance à la clé présentée.',
    de: 'Der gespeicherte Hostschlüssel von {host} wurde vergessen: Die nächste Verbindung vertraut dem angebotenen Schlüssel.',
    es: 'Se olvidó la clave de host guardada de {host}: la próxima conexión confiará en la clave que reciba.',
  },
  hostKeyPinned: {
    en: 'The host key is set in the configuration ({fingerprint}): edit or empty the “Host key” field instead.',
    fr: 'La clé d’hôte est fixée dans la configuration ({fingerprint}) : modifiez ou videz plutôt le champ « Clé d’hôte ».',
    de: 'Der Hostschlüssel ist in der Konfiguration festgelegt ({fingerprint}): stattdessen das Feld „Hostschlüssel“ ändern oder leeren.',
    es: 'La clave de host está fijada en la configuración ({fingerprint}): modifique o vacíe el campo «Clave de host».',
  },
  hostKeyNone: {
    en: 'No host key is stored yet.',
    fr: 'Aucune clé d’hôte n’est encore mémorisée.',
    de: 'Noch kein Hostschlüssel gespeichert.',
    es: 'Todavía no hay ninguna clave de host guardada.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s) “Fail2Ban diagnostic”), without any secret.',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s) « Fail2Ban diagnostic »), sans aucun secret.',
    de: 'Diagnose in die Logs der Integration geschrieben ({count} Zeile(n) „Fail2Ban diagnostic“), ohne Geheimnisse.',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s) «Fail2Ban diagnostic»), sin ningún secreto.',
  },

  // toasts and scene texts
  banDone: {
    en: '{ip} banned in {jail}.',
    fr: '{ip} bannie dans {jail}.',
    de: '{ip} in {jail} gesperrt.',
    es: '{ip} bloqueada en {jail}.',
  },
  banAlready: {
    en: '{ip} was already banned in {jail}.',
    fr: '{ip} était déjà bannie dans {jail}.',
    de: '{ip} war in {jail} bereits gesperrt.',
    es: '{ip} ya estaba bloqueada en {jail}.',
  },
  unbanDone: {
    en: '{ip} unbanned from {jails}.',
    fr: '{ip} débannie de {jails}.',
    de: '{ip} entsperrt in {jails}.',
    es: '{ip} desbloqueada en {jails}.',
  },
  unbanNone: {
    en: '{ip} was not banned.',
    fr: '{ip} n’était pas bannie.',
    de: '{ip} war nicht gesperrt.',
    es: '{ip} no estaba bloqueada.',
  },
  refreshDone: {
    en: 'Read again: {banned}.',
    fr: 'Relu : {banned}.',
    de: 'Neu gelesen: {banned}.',
    es: 'Releído: {banned}.',
  },
  summary: {
    en: 'Fail2Ban on {host}: {banned} in {jails}, {failed} now, {total} since start.',
    fr: 'Fail2Ban sur {host} : {banned} dans {jails}, {failed} en cours, {total} depuis le démarrage.',
    de: 'Fail2Ban auf {host}: {banned} in {jails}, {failed} aktuell, {total} seit dem Start.',
    es: 'Fail2Ban en {host}: {banned} en {jails}, {failed} actuales, {total} desde el arranque.',
  },
  untilPermanent: {
    en: 'permanent',
    fr: 'définitif',
    de: 'dauerhaft',
    es: 'permanente',
  },

  // widgets
  tileBanned: { en: 'Banned', fr: 'Bannies', de: 'Gesperrt', es: 'Bloqueadas' },
  tileFailed: { en: 'Failures', fr: 'Échecs', de: 'Fehlversuche', es: 'Fallos' },
  tileTotalBanned: { en: 'Total', fr: 'Au total', de: 'Gesamt', es: 'Total' },
  countBanned_one: { en: '{n} banned', fr: '{n} bannie', de: '{n} gesperrt', es: '{n} bloqueada' },
  countBanned_other: {
    en: '{n} banned',
    fr: '{n} bannies',
    de: '{n} gesperrt',
    es: '{n} bloqueadas',
  },
  countFailed_one: { en: '{n} failure', fr: '{n} échec', de: '{n} Fehlversuch', es: '{n} fallo' },
  countFailed_other: {
    en: '{n} failures',
    fr: '{n} échecs',
    de: '{n} Fehlversuche',
    es: '{n} fallos',
  },
  moreJails: { en: '+{n} jails', fr: '+{n} jails', de: '+{n} Jails', es: '+{n} jails' },
  updatedAt: {
    en: 'Updated {time}',
    fr: 'Mis à jour {time}',
    de: 'Stand {time}',
    es: 'Actualizado {time}',
  },
  noJail: {
    en: 'No jail is running on this server.',
    fr: 'Aucune jail n’est active sur ce serveur.',
    de: 'Auf diesem Server läuft keine Jail.',
    es: 'No hay ninguna jail activa en este servidor.',
  },
  buttonBan: { en: 'Ban an IP', fr: 'Bannir une IP', de: 'IP sperren', es: 'Bloquear una IP' },
  buttonUnban: { en: 'Unban', fr: 'Débannir', de: 'Entsperren', es: 'Desbloquear' },
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  fieldIp: { en: 'IP address', fr: 'Adresse IP', de: 'IP-Adresse', es: 'Dirección IP' },
  fieldIpPlaceholder: {
    en: '203.0.113.7',
    fr: '203.0.113.7',
    de: '203.0.113.7',
    es: '203.0.113.7',
  },
  fieldJail: { en: 'Jail', fr: 'Jail', de: 'Jail', es: 'Jail' },
  fieldBan: { en: 'Ban', fr: 'Bannissement', de: 'Sperre', es: 'Bloqueo' },
  allJails: {
    en: 'Every jail',
    fr: 'Toutes les jails',
    de: 'Alle Jails',
    es: 'Todas las jails',
  },
  badgePermanent: { en: 'permanent', fr: 'définitif', de: 'dauerhaft', es: 'permanente' },
  badgeBanned: { en: 'banned', fr: 'bannie', de: 'gesperrt', es: 'bloqueada' },
  unitSeconds: { en: 's', fr: 's', de: 's', es: 's' },
  unitMinutes: { en: 'min', fr: 'min', de: 'Min.', es: 'min' },
  unitHours: { en: 'h', fr: 'h', de: 'Std.', es: 'h' },
  unitDays: { en: 'd', fr: 'j', de: 'T.', es: 'd' },
  recentTitleJail: {
    en: 'Bans · {jail}',
    fr: 'Bannissements · {jail}',
    de: 'Sperren · {jail}',
    es: 'Bloqueos · {jail}',
  },
  noBan: {
    en: 'No IP is banned right now.',
    fr: 'Aucune IP n’est bannie en ce moment.',
    de: 'Derzeit ist keine IP gesperrt.',
    es: 'Ninguna IP está bloqueada ahora mismo.',
  },
  banSubtitle: {
    en: '{jail} · since {since}',
    fr: '{jail} · depuis {since}',
    de: '{jail} · seit {since}',
    es: '{jail} · desde {since}',
  },
  detailJail: { en: 'Jail: {jail}', fr: 'Jail : {jail}', de: 'Jail: {jail}', es: 'Jail: {jail}' },
  detailSince: {
    en: 'Banned at {since}',
    fr: 'Bannie à {since}',
    de: 'Gesperrt um {since}',
    es: 'Bloqueada a las {since}',
  },
  detailUntil: {
    en: 'Until {until} ({duration})',
    fr: 'Jusqu’à {until} ({duration})',
    de: 'Bis {until} ({duration})',
    es: 'Hasta {until} ({duration})',
  },
  detailPermanent: {
    en: 'Permanent ban',
    fr: 'Bannissement définitif',
    de: 'Dauerhafte Sperre',
    es: 'Bloqueo permanente',
  },
  countJails_one: { en: '{n} jail', fr: '{n} jail', de: '{n} Jail', es: '{n} jail' },
  countJails_other: { en: '{n} jails', fr: '{n} jails', de: '{n} Jails', es: '{n} jails' },
  countBans_one: { en: '{n} ban', fr: '{n} bannissement', de: '{n} Sperre', es: '{n} bloqueo' },
  countBans_other: {
    en: '{n} bans',
    fr: '{n} bannissements',
    de: '{n} Sperren',
    es: '{n} bloqueos',
  },
  bannedCount_one: {
    en: '{n} IP banned',
    fr: '{n} IP bannie',
    de: '{n} gesperrte IP',
    es: '{n} IP bloqueada',
  },
  bannedCount_other: {
    en: '{n} IPs banned',
    fr: '{n} IP bannies',
    de: '{n} gesperrte IPs',
    es: '{n} IP bloqueadas',
  },
};

/**
 * @description Whether a value is one of the four languages.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, its placeholders filled.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The placeholder values.
 * @returns {string} The text.
 * @example
 * t('banDone', 'fr', { ip: '203.0.113.7', jail: 'sshd' }); // -> '203.0.113.7 bannie dans sshd.'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A count in words, singular or plural (`<key>_one` /
 * `<key>_other`, the plural rules of the language: 0 is singular in French).
 * @param {string} key - The key without its suffix.
 * @param {number} n - The count.
 * @param {string} language - The language.
 * @returns {string} The text.
 * @example
 * plural('countBanned', 1, 'fr'); // -> '1 bannie'
 */
function plural(key, n, language) {
  const lang = isLanguage(language) ? language : 'en';
  const form = new Intl.PluralRules(lang).select(n) === 'one' ? 'one' : 'other';
  return t(`${key}_${form}`, lang, { n });
}

/**
 * @description A text in the four languages.
 * @param {string} key - A TEXTS key.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

export { LANGUAGES, TEXTS, isLanguage, t, all, plural };
