# Fail2Ban

## Overview

[Fail2Ban](https://github.com/fail2ban/fail2ban) watches the logs of a server and bans the addresses that try too many passwords. This integration brings it into Gladys: the banned IPs and the failures of each jail as devices, a scene trigger when an IP is banned or unbanned or when Fail2Ban stops answering, scene actions to ban, unban or check an address, and two dashboard widgets with Ban and Unban buttons.

Fail2Ban only answers on the machine it protects (a Unix socket). The integration therefore connects to that machine over **SSH** and runs `fail2ban-client` there, like you would in a terminal. It works with Fail2Ban 0.10 to 1.1, installed as a package or in Docker, on the Gladys host or on any other machine you can reach over SSH.

## Prerequisites

- Gladys Assistant **5.3.0** or later (the widget buttons with a form). Older instances cannot install the integration.
- A machine running Fail2Ban with an SSH server, and its address on your network.
- An SSH user allowed to run `fail2ban-client` without a password (see below).

### Prepare the server

Run these commands on the Fail2Ban server, as root (Debian, Ubuntu, Raspberry Pi OS; adapt the path of `fail2ban-client` with `command -v fail2ban-client`):

```bash
# 1. A dedicated user, without a password of its own
adduser --disabled-password --gecos "" gladys

# 2. Allow it to run fail2ban-client, and nothing else, as root
echo 'gladys ALL=(root) NOPASSWD: /usr/bin/fail2ban-client' > /etc/sudoers.d/gladys-fail2ban
chmod 440 /etc/sudoers.d/gladys-fail2ban

# 3. Prepare its authorized_keys
install -d -m 700 -o gladys -g gladys /home/gladys/.ssh
```

Then, in Gladys, fill in the configuration (below), save, and press **Show the public key**. Add the line it gives to `/home/gladys/.ssh/authorized_keys` (owner `gladys`, mode 600). It starts with `restrict`, which forbids port forwarding and terminals to that key. Finally press **Test the connection**.

- **Fail2Ban in Docker** (for instance `crazymax/fail2ban`): set the command to `docker exec fail2ban fail2ban-client`. The SSH user must then be allowed to run that command (sudoers, or the `docker` group, which amounts to root).
- **Logged in as root**: set the command to `fail2ban-client`.
- **Password instead of a key**: choose the **Password** authentication. A key is safer.

## Configuration

| Field                   | What to enter                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Address of the server   | Its IP address or host name on your network: `192.168.1.10`. Not `localhost`, which is the container of the integration.       |
| SSH port                | 22, unless your SSH server listens elsewhere.                                                                                  |
| SSH user                | The user prepared above: `gladys`.                                                                                             |
| Authentication          | **Key of the integration** (recommended) or **Password**.                                                                      |
| SSH password            | Only with the Password authentication. Stored as a secret, never shown again nor logged.                                       |
| fail2ban-client command | `sudo -n fail2ban-client` by default. The integration adds the arguments itself, quoted.                                       |
| Host key                | Optional: the SHA256 fingerprint of the server (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). Empty: the first is kept. |
| Jails to follow         | `sshd, recidive` to offer only these jails as devices. Empty: every jail.                                                      |
| Reading interval        | Every 30 seconds, minute, 2 minutes or 5 minutes.                                                                              |
| Language of the texts   | Device names and the texts given to scenes. Automatic: the language of the last widget shown.                                  |

The configuration screen also has four buttons: **Test the connection**, **Show the public key**, **Forget the host key** (after reinstalling the server: the next connection trusts the new key) and **Diagnostic** (the state of the integration in its logs, without any secret).

## Usage

### Devices

Open the **Discover** tab of the integration and create the devices you want:

- **Fail2Ban <server>**: IPs banned now (all jails), failures now, bans since Fail2Ban started, jails running.
- **Fail2Ban jail <name>**, one per jail: IPs banned now, failures now, bans and failures since Fail2Ban started, last banned IP.

The counters keep their history: a chart of the banned IPs of `sshd` over a week shows the waves of attacks. The counters "since start" restart at zero when Fail2Ban restarts.

### Dashboard widgets

![The Fail2Ban overview widget with four jails and its buttons, and the Fail2Ban bans widget with six banned addresses (generated illustration, not a screenshot)](https://raw.githubusercontent.com/William-De71/gladys-fail2ban/main/docs/assets/widgets.en.png)

- **Fail2Ban**: the IPs banned now, the failures, the total of bans, one row per jail (red with bans, orange with failures), and the buttons **Ban an IP** (address and jail), **Unban** (address, one jail or all) and **Refresh**.
- **Fail2Ban bans**: the latest bans, newest first, with their jail, since when, and what is left of the ban (or "permanent"). A tap shows the details. **Unban** offers the listed addresses. Settings: one jail only, number of bans shown (1 to 8).

### Scenes

Triggers:

- **Fail2Ban: IP banned**: an IP enters the banned list of a jail. Filters: jail, address (yours, to be warned at once). Variables: `ip`, `jail`, `banned_count`, `total_banned`, `ban_seconds`, `permanent`, `until`, `server`.
- **Fail2Ban: IP unbanned**: its ban expired or someone lifted it. Filters: jail, address.
- **Fail2Ban: server unreachable**: Fail2Ban stops answering. Filter: reason (server unreachable, Fail2Ban stopped, SSH login refused, host key changed, permission refused, other). A server that does not answer is declared down at the second failed reading in a row, so a reboot does not alert.
- **Fail2Ban: server back**: it answers again.

Actions: **ban an IP** (an address or a network such as `192.0.2.0/24`, in a jail), **unban an IP** (from one jail or all), **check an IP** (banned or not, and in which jails), **read a summary** (counters and a ready-made sentence).

Examples:

- When **an IP is banned in `recidive`** → send `{{triggerEvent.data.ip}} banned until {{triggerEvent.data.until}}` to your phone.
- When **the IP banned is your own public address** → **unban it** at once and send yourself a message.
- Every Monday at 8:00 → **read a summary** and send the `summary` output by message.

Bans and unbans made by Gladys (scene actions and widget buttons) fire no trigger, so a scene cannot loop on its own action. A ban shorter than the reading interval may come and go between two readings: no trigger then.

### Transport

Local (`"transports": ["local"]`): the integration connects directly to the server you name, nothing goes through a cloud. If that server is outside your home (a VPS), the SSH connection crosses the internet, encrypted. Only the commands of `fail2ban-client` run on the server; the private key of the integration stays in its `/data` volume.

## Troubleshooting

- **No SSH connection**: check the address (the LAN address of the machine, not `localhost` nor `127.0.0.1`) and the port, and that the server accepts SSH from the Gladys machine.
- **SSH refused the user**: the public key is missing from `authorized_keys`, or the file has wrong permissions (`chmod 600`, owner of the user). Check `/var/log/auth.log` on the server.
- **sudo asks for a password**: the sudoers rule is missing, or names another path (`command -v fail2ban-client`). Test it on the server: `sudo -u gladys sudo -n fail2ban-client ping`.
- **Permission denied to socket**: `fail2ban-client` runs without root: keep `sudo -n` in the command.
- **The host key changed**: expected after a reinstall: press **Forget the host key**. Otherwise, find out why before going on.
- **Times one or two hours off**: the integration reads the times of Fail2Ban in the timezone of Gladys, and corrects itself on the first ban it sees happen.
- **Still stuck**: press **Diagnostic**, then open an issue on [GitHub](https://github.com/William-De71/gladys-fail2ban/issues) with the versions of Gladys, of the integration and of Fail2Ban, and the "Fail2Ban diagnostic" lines of the logs (add `DEBUG=gladys-integration-sdk` in developer mode).
